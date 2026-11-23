import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSnapshot, useReportUiState, visibleNotice } from "./ui-state";

type Put = { url: string; body: unknown };
let puts: Put[] = [];
let failing = false;

beforeEach(() => {
  vi.useFakeTimers();
  puts = [];
  failing = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push({ url, body: JSON.parse(String(init.body)) });
      if (failing) return Promise.reject(new Error("offline"));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("buildSnapshot", () => {
  it("names the page from the sidebar and carries its address parameters", () => {
    expect(buildSnapshot("/logs", "?stack=full&level=error", "")).toEqual({ route: "/logs", label: "Logs", params: { stack: "full", level: "error" } });
  });

  it("has no label for a page that isn't in the sidebar, and no params or notice when there are none", () => {
    expect(buildSnapshot("/nowhere", "", "")).toEqual({ route: "/nowhere" });
  });

  it("includes the message the page shows", () => {
    expect(buildSnapshot("/hosts", "", "The agent refused the saved token").notice).toBe("The agent refused the saved token");
  });

  it("cuts what the server would refuse", () => {
    const search = "?" + Array.from({ length: 25 }, (_, i) => `k${i}=v`).join("&") + "&long=" + "x".repeat(400) + "&" + "k".repeat(80) + "=1";
    const snap = buildSnapshot("/logs", search, "");
    expect(Object.keys(snap.params ?? {})).toHaveLength(20);

    const wide = buildSnapshot("/logs", "?long=" + "x".repeat(400) + "&" + "k".repeat(80) + "=1", "");
    expect(wide.params?.long).toHaveLength(300);
    expect(Object.keys(wide.params ?? {}).every((k) => k.length <= 50)).toBe(true);
    expect(buildSnapshot("/" + "a".repeat(300), "", "").route).toHaveLength(200);
  });
});

describe("visibleNotice", () => {
  it("reads the first alert in the main area, tidied and cut", () => {
    document.body.innerHTML = `<main><p role="alert">  The logs
      couldn’t be read  </p><p role="alert">second</p></main><div role="alert">outside</div>`;
    expect(visibleNotice()).toBe("The logs couldn’t be read");
    document.body.innerHTML = `<main><p role="alert">${"x".repeat(900)}</p></main>`;
    expect(visibleNotice()).toHaveLength(500);
    document.body.innerHTML = `<main><p>fine</p></main>`;
    expect(visibleNotice()).toBe("");
    document.body.innerHTML = "";
  });
});

function Reporter() {
  useReportUiState();
  const go = useNavigate();
  return (
    <main id="main">
      <button onClick={() => void go("/hosts?host=dev")}>go</button>
      <button onClick={() => void go("/hosts?host=dev&x=1")}>go again</button>
    </main>
  );
}

const mount = (path = "/logs?stack=full") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Reporter />
    </MemoryRouter>,
  );

const settle = (ms = 500) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("useReportUiState", () => {
  it("reports the page a moment after it opens, not before", async () => {
    mount();
    await settle(300);
    expect(puts).toHaveLength(0);
    await settle(200);
    expect(puts).toEqual([{ url: "/api/v1/ui/state", body: { route: "/logs", label: "Logs", params: { stack: "full" } } }]);
  });

  it("reports a change of page once, after things are still", async () => {
    const { getByText } = mount();
    await settle();
    fireEvent.click(getByText("go"));
    fireEvent.click(getByText("go again"));
    await settle();
    expect(puts).toHaveLength(2);
    expect(puts[1].body).toEqual({ route: "/hosts", label: "Remote hosts", params: { host: "dev", x: "1" } });
  });

  it("reports an alert that appears, and when it goes", async () => {
    const { container } = mount();
    await settle();
    const alert = document.createElement("p");
    alert.setAttribute("role", "alert");
    alert.textContent = "Something failed";
    container.querySelector("main")?.appendChild(alert);
    await settle();
    expect(puts).toHaveLength(2);
    expect((puts[1].body as { notice: string }).notice).toBe("Something failed");

    alert.remove();
    await settle();
    expect(puts).toHaveLength(3);
    expect((puts[2].body as { notice?: string }).notice).toBeUndefined();
  });

  it("doesn't send the same thing twice", async () => {
    const { container } = mount();
    await settle();
    // a change that leaves the snapshot as it was
    container.querySelector("main")?.appendChild(document.createElement("span"));
    await settle();
    expect(puts).toHaveLength(1);
  });

  it("ignores a failure, and tries again at the next change", async () => {
    failing = true;
    const { getByText } = mount();
    await settle();
    expect(puts).toHaveLength(1);
    failing = false;
    fireEvent.click(getByText("go"));
    await settle();
    expect(puts).toHaveLength(2);
  });
});
