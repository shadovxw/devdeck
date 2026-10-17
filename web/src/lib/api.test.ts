import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./api";

function mockFetch(res: Response) {
  const fn = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("GETs JSON under /api/v1", async () => {
    const fn = mockFetch(Response.json({ status: "ok" }));
    await expect(api.get("/health")).resolves.toEqual({ status: "ok" });
    expect(fn.mock.calls[0][0]).toBe("/api/v1/health");
    expect(fn.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("POSTs", async () => {
    const fn = mockFetch(Response.json({}));
    await api.post("/plugins/git/check");
    expect(fn.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("throws ApiError with the server's message", async () => {
    mockFetch(Response.json({ message: "no such plugin" }, { status: 404 }));
    const err = await api.post("/plugins/x/check").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, message: "no such plugin" });
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    mockFetch(new Response("boom", { status: 502, statusText: "Bad Gateway" }));
    await expect(api.get("/health")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
});
