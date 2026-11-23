# Several compose files, compose-only stacks, and `requires`

## Why

A real workspace keeps each dependency in its own compose file in its own folder (Keycloak, Vault, Garage, the gateway), and the databases run on the machine itself. A stack could point at one compose file and had to have a service, so none of that could be a stack, and `full` could not bring the dependencies up.

## What changes (stack YAML)

- `compose` is one file (as before) **or a list** of files. They start together, before any service, and stop after the services.
- `services` may be empty when there is at least one compose file (a compose-only stack: `vault`, `storage`, `keycloak`, `gateway`).
- `requires: [{name, tcp}]`: things devdeck does not start but the stack needs, such as a local Postgres. Doctor checks that the loopback `host:port` accepts a connection and refuses the start when it doesn't, with "Start <name>, then check again."
  - Only loopback addresses are allowed (`127.0.0.1`, `localhost`, `::1`), so a workspace file can't make devdeck connect to another machine.
- Service ids `compose` and `compose-*` are reserved: devdeck uses them for the compose files in a run (`compose` for one file, `compose-<repo>` for each of several; the same repo twice gets its position added).

## Not changed

Secrets stay out of the YAML. Compose files are not edited by devdeck. A service's own env file is unchanged.
