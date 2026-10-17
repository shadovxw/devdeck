// Client for the server's /ws hub. One socket carries many topic subscriptions.
// It reconnects with exponential backoff and re-subscribes by itself, so
// components only ever say "I want topic X".

export type SocketStatus = "connecting" | "open" | "closed";
export type TopicHandler = (data: unknown, topic: string) => void;

/** The slice of the browser WebSocket this class uses (so tests can fake it). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type TopicSocketOptions = {
  url: string;
  create?: (url: string) => WebSocketLike;
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
};

const OPEN = 1;

export class TopicSocket {
  private readonly url: string;
  private readonly create: (url: string) => WebSocketLike;
  private readonly random: () => number;
  private readonly minDelay: number;
  private readonly maxDelay: number;

  private ws: WebSocketLike | null = null;
  private status: SocketStatus = "closed";
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;

  private readonly handlers = new Map<string, Set<TopicHandler>>();
  private readonly listeners = new Set<() => void>();

  constructor(opts: TopicSocketOptions) {
    this.url = opts.url;
    this.create = opts.create ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.random = opts.random ?? Math.random;
    this.minDelay = opts.minDelayMs ?? 500;
    this.maxDelay = opts.maxDelayMs ?? 10_000;
  }

  getStatus = (): SocketStatus => this.status;

  /** For useSyncExternalStore. */
  onStatus = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Opens the socket and keeps it open until close(). */
  connect(): void {
    this.wanted = true;
    if (this.ws || this.timer) return;
    this.open();
  }

  /** Closes the socket and stops reconnecting. Subscriptions are kept for a later connect(). */
  close(): void {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    this.setStatus("closed");
  }

  /**
   * Subscribes to a topic: an exact name, "prefix.*" or "*". Returns an
   * unsubscribe function. The server is told once per topic, however many
   * handlers share it.
   */
  subscribe(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      this.send("subscribe", topic);
    }
    set.add(handler);

    return () => {
      const current = this.handlers.get(topic);
      if (!current?.delete(handler)) return;
      if (current.size === 0) {
        this.handlers.delete(topic);
        this.send("unsubscribe", topic);
      }
    };
  }

  private open(): void {
    this.setStatus("connecting");
    const ws = this.create(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
      for (const topic of this.handlers.keys()) this.send("subscribe", topic);
    };
    ws.onmessage = (ev) => this.dispatch(ev.data);
    ws.onclose = () => {
      this.ws = null;
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // A close event always follows; reconnecting happens there.
    };
  }

  private scheduleReconnect(): void {
    if (!this.wanted) return;
    const ceiling = Math.min(this.maxDelay, this.minDelay * 2 ** this.attempt);
    const delay = Math.round(ceiling * (0.5 + this.random() / 2)); // jitter: 50-100% of the ceiling
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wanted) this.open();
    }, delay);
  }

  private send(op: "subscribe" | "unsubscribe", topic: string): void {
    if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify({ op, topic }));
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: { topic?: unknown; data?: unknown; sub?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.topic !== "string") return;
    // "sub" is the subscription pattern that matched; older servers omit it.
    const pattern = typeof msg.sub === "string" ? msg.sub : msg.topic;
    for (const handler of [...(this.handlers.get(pattern) ?? [])]) handler(msg.data, msg.topic);
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.listeners) l();
  }
}
