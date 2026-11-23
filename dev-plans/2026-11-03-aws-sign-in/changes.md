# AWS sign-in from the Remote hosts page: what changed

Built on 2026-11-03 (see [`plan.md`](plan.md) for the design and for why devdeck doesn't store the password).

## New

- **`internal/remote/login.go`**: `Hosts.SignIn` (runs `aws sso login` for the host's profile, up to 3 minutes, one at a time per host), `loginArgs` (checks the profile name), `ErrNotAWS`, `ErrSigningIn` (in `hosts.go`).
- **`internal/api/hosts.go`**: `POST /hosts/:ws/:host/aws-login`; `hostError` maps the two new errors to 422 and 409.
- **Web**: `useAwsSignIn` and `needsAwsSignIn` in `web/src/lib/hosts.ts`; the **Sign in to AWS** button on the host card in `HostsPage.tsx`.
- **Tests**: `internal/remote/login_test.go` (profile names), `internal/api/hosts_login_test.go` (the command, failures in words, one at a time, unknown host), two in `hosts-page.test.tsx` (sign in then connect; a failed sign-in).
