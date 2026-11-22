import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, PAUSED_MESSAGE } from "./api";
import { backoffMs, linkView, nextCheckAt, useServerLink, writesPaused, type LinkState } from "./server-link";

const base: LinkState = { failures: 0, downSince: null, lastFailAt: null, backAt: null, everUp: true };

afterEach(() => {
  useServerLink.getState().reset();
  vi.unstubAllGlobals();
});

describe("backoffMs", () => {
  it.each([
    [0, 0],
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 15_000],
    [12, 15_000],
  ])("after %i failures: %i ms", (failures, want) => {
    expect(backoffMs(failures)).toBe(want);
  });
});

describe("linkView", () => {
  it.each([
    ["up", base, 0, "up"],
    ["a blip under 2s shows nothing", { ...base, downSince: 1_000 }, 2_999, "up"],
    ["2s gone: reconnecting", { ...base, downSince: 1_000 }, 3_000, "reconnecting"],
    ["just back: connected", { ...base, backAt: 10_000 }, 11_000, "connected"],
    ["back 2s ago: nothing", { ...base, backAt: 10_000 }, 12_000, "up"],
  ] as const)("%s", (_, s, now, want) => {
    expect(linkView(s, now)).toBe(want);
  });

  it("pauses writes only once the app was up and the outage shows", () => {
    expect(writesPaused({ ...base, downSince: 0 }, 5_000)).toBe(true);
    expect(writesPaused({ ...base, downSince: 0 }, 1_000)).toBe(false);
    expect(writesPaused({ ...base, everUp: false, downSince: 0 }, 5_000)).toBe(false); // the splash is showing
  });

  it("says when the next check runs", () => {
    expect(nextCheckAt(base)).toBeNull();
    expect(nextCheckAt({ ...base, failures: 3, lastFailAt: 10_000 })).toBe(14_000);
  });
});

describe("the store", () => {
  it("counts failures from the first one, and says Connected only after an outage that showed", () => {
    const link = useServerLink.getState();
    link.answered(0);
    link.failed(1_000);
    link.failed(2_000);
    expect(useServerLink.getState()).toMatchObject({ failures: 2, downSince: 1_000, lastFailAt: 2_000 });
    link.answered(5_000);
    expect(useServerLink.getState()).toMatchObject({ failures: 0, downSince: null, backAt: 5_000, everUp: true });
    link.settled();
    expect(useServerLink.getState().backAt).toBeNull();
  });

  it("stays quiet after a blip", () => {
    const link = useServerLink.getState();
    link.failed(1_000);
    link.answered(1_500);
    expect(useServerLink.getState().backAt).toBeNull();
  });
});

describe("writes while the server is gone", () => {
  it("are not sent; reads still are", async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", fetch);
    useServerLink.setState({ ...base, downSince: Date.now() - 5_000 });

    const err = await api.post("/runs/acme/web/start").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(PAUSED_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();

    await api.get("/runs");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
