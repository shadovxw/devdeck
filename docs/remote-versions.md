# Changing image tags on a remote host

devdeck can change the image tags of a compose stack on a remote host (an EC2 instance, say) and redeploy just the containers that changed, from the **Remote hosts** page. It does what you did by hand (edit the tag, run the up script), for one service or several, with a confirmation first and a roll back after.

It needs the **agent** from release `agent-dev-3` or newer on the host (the older ones can't do this; devdeck says so). The agent is the same program as devdeck, run on the host as `devdeck agent`.

## Set the host up once

**1. Keep the image tags in their own file.** Tags change in `versions.env`, which holds only `*_IMAGE=repository:tag` lines. Secrets stay in `.env`, which the agent never opens. In the stack's folder on the host:

```bash
cp -p .env .env.before-split
{ echo "# versions.env: image tags only, nothing secret. devdeck's agent may change this file."; grep -E '^[A-Z0-9_]+_IMAGE=' .env; } > versions.env
sed -i -E '/^[A-Z0-9_]+_IMAGE=/d' .env
```

**2. Make compose read both files.** Everything that runs compose must pass both, or the images come out blank (compose reads only `.env` by itself). Either change each `docker compose -f` in your up script:

```bash
cp -p dev-up.sh dev-up.sh.before-split && sed -i 's#docker compose -f#docker compose --env-file .env --env-file versions.env -f#' dev-up.sh
```

or add this line near the top of the script (Compose 2.24 or newer):

```bash
export COMPOSE_ENV_FILES=.env,versions.env
```

After the split, an `_IMAGE=` line typed into `.env` is ignored (`versions.env` wins), so **tag changes by hand go in `versions.env`**.

Check that nothing changed: `docker compose --env-file .env --env-file versions.env -f <your files> config --images | sort -u` against `docker ps --format '{{.Image}}' | sort -u`.

**3. Tell the agent about the file**, in `/etc/devdeck/agent.yaml`:

```yaml
stacks:
  - id: apps
    name: Applications
    dir: /srv/acme
    files: [compose.yml]                      # the same files your up script uses
    env_files: [.env, versions.env]           # the agent passes these to compose
    versions_file: versions.env               # the one file it may change; must be listed above
    allow_write: true
```

Then `devdeck agent check` and restart the agent. The agent refuses a `versions_file` that isn't in `env_files`, because compose would never read the tags it writes.

## Change a tag

Open **Remote hosts**, connect the host, open the stack, **Versions**. Each service shows the tag **in the file**, the tag that **runs**, and a **differs** mark when they aren't the same (a change that was saved but never deployed, or one made by hand). Services whose image is written in the compose file itself, is pinned by digest, or whose variable lives in `.env` are shown but can't be changed here, with the reason.

Type the new tag for one or several services, then:

- **Deploy**: devdeck shows what will change (`api: 1.0.4 → 1.0.5`) and asks. Then the host saves the file (keeping the old one as `versions.env.prev`), **pulls** the new images, and **recreates only those containers** (`up -d --no-deps`), then waits up to two minutes for each to run and be healthy. If the pull fails, the file is put back as it was and nothing is restarted.
- **Save only**: only the file changes, nothing is pulled or restarted. Use it to deploy later with your up script.
- **Redeploy**: pull the tag in the file again and recreate the container, for a tag that was pushed again.

A service that doesn't come up (unhealthy, stopped, not healthy in time) is reported with its last 50 log lines, secrets masked. The new tag is **kept**, so you can see what happened.

## Roll back

The **Changes** list under the table is the host's change log: when, which service, old → new, whose token asked, and whether it was deployed and came up. **Roll back** sets that service's tag back to the old one and deploys it, after asking.

## After a build

On the **Images and tags** page, once an image is pushed, **Deploy to a host** opens this page with the repository and tag. The services that use that repository have the tag filled in: check them and deploy.

## Who did it

Each person can have their own agent token, so the host's audit log (`journalctl -u devdeck-agent`) says who did what, and one person can be cut off by removing a line. On the host:

```bash
sudo install -d -m 700 /etc/devdeck/tokens
devdeck agent token | sudo tee /etc/devdeck/tokens/alice >/dev/null && sudo chmod 600 /etc/devdeck/tokens/alice
```

```yaml
tokens:
  - {name: alice, file: /etc/devdeck/tokens/alice}
  - {name: bob, file: /etc/devdeck/tokens/bob}
# token_file: still works (its name in the log is "shared")
```

`devdeck agent check` lists the tokens. Give Alice her token to paste on her Remote hosts page; it goes to her own OS keychain. Every token must be different.

## Safety

- The agent never opens `.env`. It reads and writes `versions.env` only, and keeps that file's mode and owner (the agent may run as root while your team edits the file by hand).
- A tag is checked (`letters, digits, . - _`, 128 at most); the services come from the compose configuration; every command is a fixed list of arguments, never shell text. Volumes are never removed.
- Writes need `allow_write: true` for the stack, a confirmation here, and one write at a time per stack. A change runs to its end on the host even if the tunnel drops.
- The change log is `versions.env.changes.log` next to the file: tags, who and when, never values.
