# Phase 4, PR A: Git accounts and the credential helper

> Status: **built (2026-10-22), see `changes.md`** · covers plan §8 items 4.1 (connections), 4.2 (account rules), 4.3 (credential helper) and the identity part of 4.5; the rest of Phase 4 (repo operations, the full Repos page) is PR B.

## 1. The problem

The owner uses more than one GitHub account on one machine: a personal one for devdeck itself and an office one for the infrabot repos. Git Credential Manager asks to sign in (a browser popup or a token) whenever it can't tell which account a repo needs, and commits can go out with the wrong name and email.

## 2. Decisions

1. **Sign-in is `gh auth login`, once per account, for the whole machine** (OAuth in the browser). `gh` keeps several accounts side by side and keeps their tokens in the Windows credential store. **devdeck stores no tokens.** It remembers only which `gh` user a connection stands for, and asks `gh auth token --hostname github.com --user <user>` at the moment git needs it. (About 170 ms per call.) The active account of `gh` is never relied on.
2. **Connections and rules live in devdeck's own data folder** (`<data>/git-accounts.yaml`), not in a repo and not in a workspace: the credential helper sees only a remote address, so the rules can't depend on a workspace. They name private organisations, so they never go in the public repo (the data folder is outside it).
3. **A connection** is `{id, gh_user, name, email}`: which `gh` account, and the commit identity to use with it. **A rule** is `{match, connection}`; `match` is `github.com/<owner>/<repo>`, `github.com/<owner>/*` or `github.com/*`. The most specific rule wins; a username in the remote's URL (`https://shadovxw@github.com/...`) that names a connection wins over rules.
4. **The credential helper is `devdeck git-credential`**, git's credential protocol: `get` answers `username=<gh user>` and `password=<token>` for a repo a rule (or a URL username) matches, and says nothing otherwise, so the next helper (Git Credential Manager) handles it exactly as before. `store` and `erase` do nothing: devdeck keeps nothing. It never prints a token anywhere but to git.
5. **Setup changes the user's global git config, so it is previewed and undoable.** For `https://github.com` only: `useHttpPath=true` (so git sends the repo path) and a helper list that puts devdeck first and keeps the helpers that were there after it. What was there before is saved, and Undo restores it. Applying needs a confirmation in the UI.
6. **Commit identity per repo:** the Repos page shows each workspace repo's remote, the account a rule picks for it, and whether `user.name` and `user.email` already match; one button writes them to that repo's local git config. A repo that no rule matches is flagged.
7. **HTTPS only.** SSH remotes are shown but not handled (the owner uses HTTPS).
8. Tests never touch the real git config or `gh`: git runs with `GIT_CONFIG_GLOBAL` pointing at a temporary file, and `gh` is replaced by canned answers.

## 3. Pieces

- `internal/gitx`: `gh.go` (accounts, tokens, test connection), `remote.go` (parse a remote, match rules), `config.go` (the YAML file), `credential.go` (the helper), `setup.go` (preview, apply, undo), `repos.go` (inspect a repo, write its identity).
- `cmd/devdeck`: `devdeck git-credential <get|store|erase>`.
- API `/api/v1/git/...`: accounts, config, test connection, setup, repos, identity. Tokens never leave the Go process except to git.
- Web: the **Connections** page (`gh` accounts, connections, rules, git setup) and the **Repos** page (account chip and identity per repo).

## 4. Done when (from the plan)

Pushing from VS Code in an infrabot repo uses the office account and identity, devdeck's own push uses the personal one, and a repo with no matching rule is flagged.
