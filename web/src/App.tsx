import { useEffect, useState } from "react";

type Health = { status: string; version: string };
type State = { kind: "loading" } | { kind: "ok"; health: Health } | { kind: "down" };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/v1/health", { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(String(r.status)))))
      .then((health) => setState({ kind: "ok", health }))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setState({ kind: "down" });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <main>
      <h1>devdeck</h1>
      <p title="GET /api/v1/health">
        {state.kind === "loading" && "connecting…"}
        {state.kind === "down" && "server not reachable"}
        {state.kind === "ok" && `server ${state.health.status} · ${state.health.version}`}
      </p>
    </main>
  );
}
