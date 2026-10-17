import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TopicSocket, type WebSocketLike } from "./ws";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: Array<{ op: string; topic: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  send(data: string) {
    this.sent.push(JSON.parse(data) as { op: string; topic: string });
  }
  close() {
    this.closed = true;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let sockets: FakeSocket[];

function make() {
  return new TopicSocket({
    url: "ws://test/ws",
    create: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    random: () => 1, // no jitter: delay equals the ceiling
    minDelayMs: 500,
    maxDelayMs: 4000,
  });
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("TopicSocket", () => {
  it("subscribes after the socket opens, once per topic", () => {
    const ws = make();
    const off1 = ws.subscribe("svc.status", () => {});
    ws.subscribe("svc.status", () => {});
    ws.connect();
    expect(sockets[0].sent).toEqual([]);

    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ op: "subscribe", topic: "svc.status" }]);

    off1(); // another handler still listens, so no unsubscribe yet
    expect(sockets[0].sent).toHaveLength(1);
  });

  it("sends subscribe and unsubscribe while open", () => {
    const ws = make();
    ws.connect();
    sockets[0].open();

    const off = ws.subscribe("logs.*", () => {});
    off();
    off(); // calling twice is harmless
    expect(sockets[0].sent).toEqual([
      { op: "subscribe", topic: "logs.*" },
      { op: "unsubscribe", topic: "logs.*" },
    ]);
  });

  it("routes each message to the subscription that matched", () => {
    const ws = make();
    const wild: unknown[] = [];
    const exact: unknown[] = [];
    ws.subscribe("logs.*", (d) => wild.push(d));
    ws.subscribe("logs.demo", (d) => exact.push(d));
    ws.connect();
    sockets[0].open();

    sockets[0].receive({ topic: "logs.demo", data: 1, sub: "logs.*" });
    sockets[0].receive({ topic: "logs.demo", data: 2, sub: "logs.demo" });
    sockets[0].receive({ topic: "logs.demo", data: 3 }); // older server: falls back to the topic name

    expect(wild).toEqual([1]);
    expect(exact).toEqual([2, 3]);
  });

  it("ignores malformed messages", () => {
    const ws = make();
    const got: unknown[] = [];
    ws.subscribe("t", (d) => got.push(d));
    ws.connect();
    sockets[0].open();

    sockets[0].receive("not json");
    sockets[0].receive({ data: 1 });
    sockets[0].receive({ topic: 5 });
    sockets[0].onmessage?.({ data: new ArrayBuffer(1) });
    expect(got).toEqual([]);
  });

  it("reconnects with growing delays, resubscribes, and resets after success", () => {
    const ws = make();
    ws.subscribe("svc.status", () => {});
    ws.connect();
    sockets[0].open();
    expect(ws.getStatus()).toBe("open");

    sockets[0].drop();
    expect(ws.getStatus()).toBe("closed");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // after 500 ms

    sockets[1].drop(); // never opened: next delay doubles
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3); // after 1000 ms

    sockets[2].open();
    expect(sockets[2].sent).toEqual([{ op: "subscribe", topic: "svc.status" }]);

    sockets[2].drop(); // a successful open reset the backoff to 500 ms
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);
  });

  it("caps the delay", () => {
    const ws = make();
    ws.connect();
    for (let i = 0; i < 6; i++) {
      sockets[i].drop();
      vi.advanceTimersByTime(4000); // max delay is enough every time
    }
    expect(sockets).toHaveLength(7);
  });

  it("close() stops reconnecting; connect() starts again and keeps subscriptions", () => {
    const ws = make();
    ws.subscribe("t", () => {});
    ws.connect();
    sockets[0].open();

    ws.close();
    expect(sockets[0].closed).toBe(true);
    expect(ws.getStatus()).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    ws.connect();
    sockets[1].open();
    expect(sockets[1].sent).toEqual([{ op: "subscribe", topic: "t" }]);
  });

  it("notifies status listeners", () => {
    const ws = make();
    const seen: string[] = [];
    ws.onStatus(() => seen.push(ws.getStatus()));
    ws.connect();
    sockets[0].open();
    sockets[0].drop();
    expect(seen).toEqual(["connecting", "open", "closed"]);
  });
});
