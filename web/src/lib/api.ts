import { useServerLink, writesPaused } from "./server-link";
import type { Issue } from "./types";

const base = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  /** Problems found in a file the server refused, when it says which. */
  readonly issues: Issue[];
  /** The whole JSON body of the refusal, for answers that carry more than a message (a Doctor report). */
  readonly data: unknown;

  constructor(status: number, message: string, issues: Issue[] = [], data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
    this.data = data;
  }
}

/** What a write says while the server is gone (lib/server-link.ts): it is not sent at all. */
export const PAUSED_MESSAGE = "devdeck is reconnecting to its server. Try again once it is back.";

async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  // Writes wait while the server is gone; reading still tries, so the page keeps its last data.
  if (method !== "GET" && writesPaused(useServerLink.getState())) throw new ApiError(0, PAUSED_MESSAGE);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, {
    method,
    signal,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let issues: Issue[] = [];
    let body: unknown;
    try {
      body = await res.json();
      const data = body as { message?: unknown; issues?: unknown };
      if (typeof data.message === "string") message = data.message;
      if (Array.isArray(data.issues)) issues = data.issues as Issue[];
    } catch {
      // not JSON; keep the status text
    }
    throw new ApiError(res.status, message, issues, body);
  }
  // Stop and restart answer with no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", path, body, signal),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("PUT", path, body, signal),
  delete: <T>(path: string, signal?: AbortSignal) => request<T>("DELETE", path, undefined, signal),
};
