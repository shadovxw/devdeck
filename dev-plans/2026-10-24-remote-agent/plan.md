# Remote hosts: the devdeck agent

> Status: **plan, not started** · goal: manage the compose stacks on a remote Linux host (an EC2 instance with no public address, reached through SSM) as devdeck manages local ones: see every service and its health, follow logs, start, stop and restart, bring a stack up or down, and change image tags. Several stacks per host. The next phase does the same for a Helm-deployed stack.

## 1. The problem

A dev environment runs on an EC2 instance from docker compose: shared infrastructure (a database, a message bus, a secrets store, object storage, an identity provider, a reverse proxy) and about a dozen application services from prebuilt images. Today it is managed by signing in to AWS, opening an SSM session and typing `docker` and `docker compose`. Image tags live in a `.env` file next to the secrets.

devdeck can already do all of this for stacks on the local machine (its supervisor runs `docker compose ps`, `logs --follow`, `up`, `stop`), but not on another machine.

## 2. Decisions

1. **A small program on the host, `devdeck agent`, does the Docker work there.** It is the same binary as devdeck, one more sub-command (as `devdeck git-credential` is), built for Linux. It runs the same compose commands the local supervisor runs, in each stack's own folder, so relative bind mounts and `.env` files resolve on the host as they do today.
2. **It listens on `127.0.0.1` only.** No port is opened in the security group. The laptop reaches it through an SSM port-forwarding session, so getting to it already needs the user's AWS sign-in and IAM permission.
3. **A fixed list of actions, never a shell.** Every command is an argument list built from values the agent checked itself. A stack must be one in its own configuration, a service one that `docker compose config --services` returns for that stack, and a tag must match `^[A-Za-z0-9_.-]{1,128}$`. Nothing the client sends is ever run as text.
4. **A token as a second lock.** A random 32-byte token in a file only the agent's user can read, sent as `Authorization: Bearer`, compared in constant time. devdeck keeps its copy in the OS keyring, never in YAML.
5. **Read-only until switched on.** Writes (start, stop, restart, up, down, tag changes) are allowed per stack in the agent's configuration (`allow_write: true`), and each one also asks for a confirmation in devdeck's UI. The infrastructure stack can stay read-only while the application stack is writable.
6. **Many stacks per host.** The agent reads `/etc/devdeck/agent.yaml`, which lists the stacks on that host: each with an id, a folder, its compose files, its env files and its versions file. One agent serves all of them.
7. **Secrets never leave the host.** The agent never reads `.env`. It returns names, states, health and image tags only.
8. **One `Runtime` interface on the devdeck side**, so Helm slots in later: `Stacks`, `Services`, `Logs`, `Act` (start, stop, restart), `Up`, `Down`, `Versions`, `SetVersion`. The local compose supervisor is one implementation, the agent is another, Kubernetes is the next.
9. **Host configuration stays private.** Which instance, AWS profile and region: in the private workspace repo. This public repo's code, tests and docs use neutral names (`acme`, `demo-api`, `example.com`).

## 3. Several stacks on one host

### What a stack is on the host

```yaml
# /etc/devdeck/agent.yaml (on the instance; no secrets in it)
listen: 127.0.0.1:7071
token_file: /etc/devdeck/token
stacks:
  - id: infra
    name: Infrastructure
    dir: /srv/acme
    files: [compose.infra.yml]
    env_files: [.env, versions.env]
    versions_file: versions.env
    allow_write: false        # look, don't touch
  - id: apps
    name: Applications
    dir: /srv/acme
    files: [compose.apps.yml]
    env_files: [.env, versions.env]
    versions_file: versions.env
    allow_write: true
    after: [infra]            # bring infra up (and healthy) first
```

`after` gives an order across stacks: **Up all** starts `infra`, waits until its services with a health check are healthy, then starts `apps`. **Down all** goes the other way.

### Splitting the current single project in two

Today everything is one compose project made of two files. It works with the agent as it is (one stack, two files), so splitting is optional. It is still worth it: restarting or updating the applications should never touch the database, and the infrastructure changes rarely. To split safely:

1. **One shared network, made once**: `docker network create acme-net`, and in both files `networks: default: { name: acme-net, external: true }`. Services still find each other by name (`postgres`, `nats:4222`), as now.
2. **Keep the data.** Compose names volumes after the project (`infrabot_garage-data`). A new project name would mean new, empty volumes. So each volume gets its current name written out: `volumes: garage-data: { name: infrabot_garage-data }`. Nothing is copied or lost, and the bootstrap script checks that each named volume already exists before the first `up`.
3. **`depends_on` across files doesn't work**, so the applications rely on the agent's `after` order and on their own retries. The services that wait for `postgres: service_healthy` today keep that check inside the infrastructure file only.
4. **Container names stay the same** (`container_name:` is already set), so nothing else changes.

The split is done once by a script, with a dry run that prints the new files and the commands, and is reversible (the old files are kept).

## 4. Changing the image tags

`.env` mixes secrets and tags. It is **split in two**:

- `.env`: secrets and settings. **The agent never opens it.** Compose still reads it.
- `versions.env`: only the `*_IMAGE=repo/name:tag` lines. Nothing secret. The only file the agent writes.

Compose reads both: `docker compose --env-file .env --env-file versions.env ...` (the later file wins, Compose 2.24 or newer, checked by the bootstrap). The up script changes by one argument.

`SetVersion {stack, service, tag}`:

1. Checks the stack allows writes, the service exists and the tag matches the pattern.
2. Finds the service's image variable in the compose file (`image: ${AUTH_SERVICE_IMAGE}`), then that line in `versions.env`, and changes only the part after the last colon. The repository part is kept.
3. Saves the old file as `versions.env.prev` and appends to `/var/lib/devdeck/changes.log`: when, stack, service, old tag, new tag.
4. Runs `docker compose pull <service>`, then `docker compose up -d --no-deps <service>`, which recreates that one container.
5. Waits up to a set time for it to run (and be healthy, if it has a health check) and reports. A failed pull leaves the file as it was. An unhealthy container is reported with its last log lines and a **Roll back** button.

**Roll back** sets the previous tag the same way. **Changing several tags at once** (a release) is one request that does steps 1 to 3 for all of them, then pulls and recreates them in compose order.

**Changing a secret is not in this work.** If wanted later, it would be write-only: devdeck takes the value from the keyring, the agent writes it into `.env` and never returns it, and the log records the name only.

## 5. How it works, in code

### The agent (on the host)

An HTTP server with a token check in front of a small set of handlers:

```go
// internal/agent/server.go (shape)
func (a *Agent) routes() http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /v1/info", a.info)                                  // version, API version, stacks
    mux.HandleFunc("GET /v1/stacks/{stack}/services", a.services)           // compose ps --format json
    mux.HandleFunc("GET /v1/stacks/{stack}/services/{svc}/logs", a.logs)    // streamed
    mux.HandleFunc("POST /v1/stacks/{stack}/services/{svc}/{action}", a.act) // start|stop|restart
    mux.HandleFunc("POST /v1/stacks/{stack}/{action}", a.stackAct)          // up|down
    mux.HandleFunc("GET /v1/stacks/{stack}/versions", a.versions)
    mux.HandleFunc("PUT /v1/stacks/{stack}/versions", a.setVersions)        // one or several tags
    return a.auth(a.audit(mux))                                             // token, then a log line per call
}
```

Each stack turns into the start of a compose command, built once from its configuration:

```go
func (s Stack) compose(args ...string) []string {
    out := []string{"compose", "--project-directory", s.Dir}
    for _, f := range s.Files { out = append(out, "-f", f) }
    for _, e := range s.EnvFiles { out = append(out, "--env-file", e) }
    return append(out, args...)
}
// restart: exec.CommandContext(ctx, "docker", s.compose("restart", svc)...), with Dir = s.Dir
```

**Logs are streamed.** The handler starts `docker compose logs --follow --timestamps --since <t> <svc>`, copies each line into the response and flushes after each one, so it arrives at once. When devdeck disconnects, the request's context is cancelled, which stops the child process. devdeck reconnects with `since` set to the last timestamp it has, so a dropped tunnel loses no lines.

```go
cmd := exec.CommandContext(r.Context(), "docker", st.compose("logs", "--follow", "--timestamps", "--since", since, svc)...)
out, _ := cmd.StdoutPipe()
_ = cmd.Start()
sc := bufio.NewScanner(out)
for sc.Scan() {
    fmt.Fprintln(w, sc.Text())
    w.(http.Flusher).Flush()
}
```

The local supervisor already parses `compose ps --format json` and follows `compose logs`. That code moves into a package both use, so the agent and the local stacks behave the same.

### devdeck (on the laptop)

1. **Hosts in configuration** (private workspace): `{id, kind: aws-ssm, profile, region, instance: i-... or a Name tag, agent_port: 7071}`. The token is in the keyring.
2. **The tunnel manager** runs `aws ssm start-session --target <instance> --document-name AWS-StartPortForwardingSession --parameters portNumber=7071,localPortNumber=<free port>` as a child process, waits until `/v1/info` answers, and restarts it when it drops (SSM ends idle sessions). It is opened when a page needs it and closed after a few idle minutes.
3. **The client** implements `Runtime` over HTTP. Log lines go into the existing pipeline (parsers, groups, ring and day files), labelled with host and stack, so the Logs page, its filters and its histogram work unchanged.
4. **The pages.** Stacks gets a host switcher (This PC, plus each remote host). A remote stack has the same service table (Logs, Stop, Start, Restart), Up and Down, and an **Up all / Down all** for the host in `after` order. A **Versions** panel lists each service's tag with a field to change it, a multi-select for a release, the history and Roll back.

## 6. Where the agent binary comes from

The instance needs the `devdeck` binary for Linux. There are two places to keep it:

| | GitHub release assets | An S3 bucket |
|---|---|---|
| What | CI builds `devdeck-linux-amd64` and `-arm64` for each release tag and attaches them, with a `SHA256SUMS` file | You (or CI) upload the same files to a bucket |
| Access | Public, since the repo is public. Needs outbound internet from the instance | Private. The instance role needs `s3:GetObject` on that bucket. Works with no internet (VPC endpoint) |
| Trust | The script pins a version and checks the checksum | Bucket permissions, plus the same checksum |
| Effort | One release workflow, nothing in AWS | A bucket, a policy and an upload step |

**The choice: GitHub releases.** The binary contains nothing private (all host details live in `agent.yaml` on the instance), the instance already reaches Docker Hub so it has outbound internet, and nothing needs creating in AWS. The bootstrap downloads a pinned version and refuses it if the checksum doesn't match. If an instance ever has no internet access, the same script takes `--from-s3 s3://bucket/path` instead.

The Linux build needs no C compiler (the SQLite driver is pure Go), so `GOOS=linux CGO_ENABLED=0 go build` gives one static file. Updating later: devdeck shows the agent's version next to its own and offers the exact update command (run through SSM).

## 7. A new EC2 instance

**On AWS, once:**

- The instance has an IAM instance profile with `AmazonSSMManagedInstanceCore` (and the SSM agent, which Amazon Linux has).
- Your IAM user or role may run `ssm:StartSession` on that instance with the `AWS-StartPortForwardingSession` document.
- Your laptop has the AWS CLI and the Session Manager plugin. devdeck's Doctor checks both and your sign-in.

**On the instance, one script (`agent/bootstrap.sh`, run through SSM or as user data):**

1. Checks Docker and Compose 2.24 or newer.
2. Creates a `devdeck` user in the `docker` group.
3. Downloads the pinned `devdeck` release, checks it, installs it to `/usr/local/bin`.
4. Writes `/etc/devdeck/agent.yaml` from arguments (`--stack apps=/srv/acme:compose.apps.yml ...`), creates the token file (mode 600) and `/var/lib/devdeck`.
5. Installs a systemd unit (`devdeck-agent.service`, user `devdeck`, restart on failure) and starts it.
6. Prints what to do on the laptop: the host entry for devdeck and the token to paste (saved to the keyring, shown once).

**The stack itself** (compose files, `.env`, `versions.env`) is copied or cloned to the folder as today. The split script from §3 and the env split from §4 are run once.

## 8. Security, in one place

- Listens on localhost; reached only through SSM, so IAM decides who gets in.
- Token checked in constant time; never logged; in the keyring on the laptop.
- No shell: argument lists only, every value validated against the stack's own configuration.
- Writes allowed per stack, and confirmed in the UI.
- Runs as a `devdeck` user in the `docker` group, not `root`. (Membership of `docker` is close to root on that host, which is why the action list is fixed.)
- Never reads `.env`. Writes only `versions.env`, with a backup and a log.
- Every request is logged on the host (`journalctl -u devdeck-agent`).

## 9. Order of work

> The first slice (compose view, versions, logs, control) is detailed in [`milestone-1.md`](milestone-1.md); its PR list replaces the table below where they differ.

| PR | What | Done when |
|---|---|---|
| 1 | The `Runtime` interface; compose code shared between the local supervisor and the agent; the agent's config file, token, `info`, `services`, `logs` (read-only, many stacks); the client over a port | Several stacks on a Linux box show their services and live logs in devdeck, over a tunnel opened by hand |
| 2 | Hosts in config; the SSM tunnel manager with reconnect; Doctor checks; host switcher in Stacks; logs into the Logs page | One click opens the tunnel and shows every stack of the host |
| 3 | Start, stop, restart, up, down, Up all and Down all in `after` order; `allow_write`; audit log | The application stack restarts from devdeck while the infrastructure stack refuses |
| 4 | `versions.env`, `SetVersion` for one or several services, history, roll back | A tag change pulls and recreates one container, and Roll back undoes it |
| 5 | Linux release builds with checksums; `bootstrap.sh`; the stack split and env split scripts with dry runs; the walkthrough | A fresh instance goes from nothing to visible in devdeck with the script |

**Next phase, Helm:** a Kubernetes `Runtime` (deployments and pods as services, `logs -f`, `rollout restart`, scale to zero for stop), with the tag change as `helm upgrade --reuse-values --set <image>.tag=<tag>`. It reaches the cluster API through the same SSM tunnel kind (or the agent runs `kubectl` on a host that has access). The pages and the log pipeline stay as they are.

## 10. Later, after logs and tags (PR 6 onwards)

- **Host health:** CPU, memory and disk use of the host, and per container (`docker stats`), sampled by the agent. Shares its sampling with Phase 5.
- **Image clean-up:** the images no container uses, with their size, as a list first (a dry run), then `docker image prune` for the chosen ones after a confirmation. Never removes an image a container runs or a stack's current tag.
- **Unseal the secrets store:** the recommended route is auto-unseal with AWS KMS (the store's own `seal "awskms"` setting), so it unseals itself after every restart and no keys are handled at all. If manual unsealing stays, the key shares live in the laptop's OS keyring, devdeck sends them one request at a time over the tunnel, the agent passes them to the store's `sys/unseal` API on localhost and keeps nothing. The keys are never stored on the same host as the store.
- **Open the web UIs of the stack's services:** the tunnel manager forwards a second port (the secrets store's UI, the object store's admin API) and devdeck opens it in the browser. Native pages in devdeck (names of secrets, buckets and sizes, never values) could follow.
- **Host-defined actions:** extra buttons written in `agent.yaml` by whoever runs the host (an id, a label, a fixed command, the stack it belongs to, whether it writes). devdeck can trigger them but never change what they run, so the "no shell" rule holds.

## 11. Open questions

- The instance's architecture (amd64 or arm64), for the first release build.
- Whether to split the current project into infrastructure and applications now or keep it as one stack until later (both work).
- Whether "change tag" should also list the tags available on Docker Hub (needs the Phase 9 Docker Hub connection; not in this plan).
