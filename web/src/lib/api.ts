import type { Issue } from "./types";

const base = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  /** Problems found in a file the server refused, when it says which. */
  readonly issues: Issue[];

  constructor(status: number, message: string, issues: Issue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
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
    try {
      const data = (await res.json()) as { message?: unknown; issues?: unknown };
      if (typeof data.message === "string") message = data.message;
      if (Array.isArray(data.issues)) issues = data.issues as Issue[];
    } catch {
      // not JSON; keep the status text
    }
    throw new ApiError(res.status, message, issues);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", path, body, signal),
};
