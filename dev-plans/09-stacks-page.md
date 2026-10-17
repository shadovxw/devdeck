# Phase 2, part 3: Stacks page and Home

The screen for the supervisor: start and stop a stack from the browser, watch its services come up in order, and see what is running from the Home page. It reads the supervisor's API and follows its live updates; it adds no server code.

## Stacks page (`/stacks`)

- A workspace picker (kept in the address as `?workspace=`), then one card per stack. It opens on the first workspace that is your own and has no errors.
- **Card header:** the stack's name and a state in words and shape (Stopped, Starting, Running, Needs attention, Stopping), "Up 2m 14s" while running, a **Start** or **Stop** button, and a link to Doctor for that stack.
- **Start order:** the stack's services as columns, left to right (Dependencies, then each wave of services that can start together). Each box takes its state from the real status, and the line between two columns fills once everything before it is ready. Nothing in it is a timer, and with reduced motion it just changes.
- **Services table**, shown once the stack has been started: state, service, port, how long it has been ready, restarts, and a restart button per service (also retries a failed or blocked one). A failed, blocked or restarting service says why in plain words under its row.
- **Start refused:** if the machine isn't ready, the card lists only the checks that failed, each with its fix (commands can be copied), and a link to Doctor for the stack. Any other refusal (already running, workspace has errors) is shown as its message.
- **Sample workspaces** show a disabled Start with the reason. A workspace with errors does too.

## Home (`/`)

- With something running: a strip (stacks running, services ready out of all, problems, whether live updates are on), every running stack's services with state, a link to each ready service's port, how long it has been up and the reason for any problem, and quick links to Stacks, Doctor and Workspaces.
- With nothing running: "Nothing is running" with a button to Stacks, or the original "connect a workspace" screen when there is no workspace yet.

## How it stays live

- `useRuns` fetches `GET /api/v1/runs` once, then applies every update on the `stacks.*` topic to the cached list (`mergeRun`: replace that stack, or remove it when it has stopped). After the socket reconnects it fetches again, in case updates were missed.
- Start puts the first status in the list straight from the answer; Stop and restart fetch the list again.
- The API client now accepts empty answers (stop answers 204, restart 202) and keeps the whole JSON body of a refusal, which is how the Doctor report reaches the card.

## Code

- `lib/runs.ts`: `mergeRun`, `startOrder`, `tally`, `formatUptime` (all tested).
- `lib/queries.ts`: `useRuns`, `useStartStack`, `useStopStack`, `useRestartService`.
- `design/ServiceStateMark.tsx`, `design/BootSequence.tsx`, `design/CheckRow.tsx` (moved out of the Doctor page, shared by it and the Stacks page).
- `pages/StacksPage.tsx`, `pages/HomePage.tsx`; styles for the turning arc and the filling line are in `design/motion.css`.
- `SocketProvider` takes an optional socket so tests can push live updates through a fake.

## Verified

84 web tests (the new ones cover the page, a refused start, failed and blocked services, restart, stop, live updates through a fake socket, and Home). By hand in a real browser against a real devdeck binary: the services went Waiting, Starting, Ready in order with the line filling, a service that isn't installed showed as Failed with the next one Blocked, Home showed both stacks with the port link, the page worked at phone width, and Stop left no process behind.

## Left in Phase 2

- 2.5 `devdeck up / down / status` for the terminal
- 2.1.3 install missing tools from the UI (needs a confirm step and streamed output)
