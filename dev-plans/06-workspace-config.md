# Phase 0.5: Workspace config

What was built, and how to use it.

## Files

A workspace is a folder with plain YAML files. Nothing secret goes in them.

```
<workspaces dir>/<name>/
  workspace.yaml     repos, connections, account rules
  stacks/*.yaml      groups of services to run together
  flows/*.yaml       steps that run tools in order
```

The workspaces folder is `<data dir>/workspaces` unless `DEVDECK_WORKSPACES_DIR` is set.
`DEVDECK_EXAMPLES_DIR` points at read-only sample workspaces (`examples/workspaces`). It is off by default and not set in `mise.toml`, so the sample does not show up in the app; set it to `examples/workspaces` to see it again. The tests use the sample directly.

## Checking

`internal/workspace` checks a file in two passes:

1. **Shape**: an embedded JSON Schema (`schemas/*.schema.json`). Unknown keys, missing keys, bad names and wrong types are reported in plain words, with the line.
2. **Meaning**: references between files (repo ids, connection ids, service `after` chains, flow `needs` chains, duplicate ids and ports), folders that are missing on this machine, and secret-looking values. This pass is skipped for a file whose shape is wrong.

Every problem is an issue with a file, a line, a severity (error or warning) and a message.

Add this line at the top of a file to get the same checks inside VS Code (use the schema file from this repo):

```yaml
# yaml-language-server: $schema=../../../internal/workspace/schemas/workspace.schema.json
```

## Scanning

Scanning a folder lists the sub-folders that are git repositories, guesses each one's language, reads the `origin` remote from `.git/config` (credentials are always dropped), and drafts a `workspace.yaml`. It never runs git and never writes anything. Saving is a separate step.

## API

| Route | Does |
| --- | --- |
| `GET /api/v1/workspaces` | list, with counts and problem counts |
| `GET /api/v1/workspaces/:id` | one workspace with all its problems |
| `POST /api/v1/workspaces/validate` | check YAML text without saving |
| `POST /api/v1/workspaces/scan` | draft a workspace from a folder |
| `POST /api/v1/workspaces` | save a new workspace (409 if the name is taken, 422 with issues if invalid) |

## UI

The Workspaces page lists workspaces, opens one to show its repos and problems, and has an "Add workspace" flow: scan a folder, edit the drafted YAML (checked as you type), then create it.
