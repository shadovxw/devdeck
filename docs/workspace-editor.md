# Editing workspace.yaml

Open **Workspaces**, then the pencil on a workspace. The page edits the real `workspace.yaml`; nothing is written until you review and save.

## Two views of one file

- **YAML** is the file as text, with colours, line numbers, folding and suggestions: start typing a key or a value (`type: d`) and the schema offers what is allowed. A blue mark in the margin shows every line changed since the last save; problems are underlined, and hovering one shows the message and what can fix it.
- **Form** shows the name, root, description and each repo as fields. It edits the same text, so your comments, blank lines and key order stay. Anything it doesn't show (connections, hosts, account rules) is left as it is.

The left column is an outline (sections and repos, with a dot on the ones that have a problem). The right column shows the repo under the cursor as this machine sees it (folder, branch, remote, profile, the stacks that use it), the problems, and three overall checks.

## Fixing a problem

A repo whose folder isn't a git repository gets a warning with two fixes:

- **Mark `local_only: true`** adds that line to the repo (a folder meant to stay outside git, such as infrastructure files). The warning goes away.
- **Run git init** asks first, then runs `git init` in that folder. It only works on a folder that exists inside the workspace root and has no `.git`, and the repo must already be saved in the file.

## Saving

**Review & save** (Ctrl or ⌘ + S) shows the saved file and your edits side by side. Save is only possible when the file is valid. The old file is kept next to it as `workspace.yaml.prev`.

If the file changes on disk while you have it open (VS Code, git, another tab), the page says so within a few seconds, and a save never overwrites it silently:

- **Compare** shows the two versions.
- **Reload** takes the file as it is on disk and drops your edits.
- **Keep mine** (in Compare) keeps your edits and makes your next save replace the other version.

Leaving the page with unsaved edits asks first. Samples open read-only. **VS Code** opens the file in VS Code.

## For other editors

`GET /api/v1/schema/workspace` (also `stack`, `flow`, `log-filters`) serves the JSON Schema the checks use. In VS Code with a YAML extension, put this on the first line of a `workspace.yaml` to get the same suggestions:

```yaml
# yaml-language-server: $schema=http://127.0.0.1:7070/api/v1/schema/workspace
```

`devdeck schema workspace` prints it too, and `devdeck workspace check <name>` checks a file from the command line.
