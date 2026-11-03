# AWS sign-in from the Remote hosts page

> 2026-11-03 · owner: Vrishank Warrier · builds on the remote agent ([`2026-10-24-remote-agent`](../2026-10-24-remote-agent/plan.md)) · status: **built (2026-11-03)**

## Goal

When a host's connection fails because the AWS sign-in has run out, the card shows a **Sign in to AWS** button. It runs `aws sso login --profile <profile>` for the host (the AWS CLI opens the sign-in page in the browser), waits until it is finished there, then connects again. No copying a command into a terminal.

## Decision: devdeck does not keep the AWS password

It was asked whether devdeck could store the username and password (in `.env` or the Windows credential store) and fill the sign-in page itself. It does not, on purpose:

- The page belongs to the company's identity provider. A password for it is a credential for much more than this app, and `CLAUDE.md` says secrets stay in the OS keyring and out of files; a `.env` is the wrong place for it, and the keyring would still hand devdeck a password it has no other use for.
- The page asks for more than a password (MFA, "trusted device", the CLI's own authorise step). A script that fills a login form breaks when that changes, and often counts as the bot-like sign-in such pages are built to block.
- What stays after the button: one click on Sign in (the browser's password manager fills the form) and one on Allow. Ticking "This is a trusted device" on the page, or asking the AWS administrator for a longer SSO session, reduces how often it happens.

## Design

- `POST /api/v1/hosts/:ws/:host/aws-login` → 204 when signed in. 404 unknown host, 422 not an AWS host, 409 when a sign-in for that host is already open, 502 with the reason otherwise (AWS CLI missing, the sign-in didn't finish, three minutes passed).
- The command is `aws sso login`, plus `--profile <name>` when the host names one. The name must match `^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$`, so a workspace file can't pass an option.
- It runs through the same starter as the tunnel (`Tunnels.start`), so tests stand in for the CLI.
- The button shows when the host is `aws-ssm` and the connection error says the sign-in has expired, while a sign-in runs, and after one failed. It disables itself and says "Waiting for the browser…" while the page is open.
