import { describe, expect, it } from "vitest";

import { initials } from "./WorkspaceCards";

describe("initials", () => {
  it.each([
    ["acme", "ac"],
    ["poster-demo", "pd"],
    ["acme-shop-api", "as"],
    ["My Big Project", "MB"],
    ["x", "x"],
    ["--web--", "we"],
    ["éclair", "éc"],
    ["🚀 launch", "la"], // a symbol is no initial
    ["!!", "!!"], // nothing but symbols: show them rather than nothing
  ])("%s → %s", (name, want) => expect(initials(name)).toBe(want));
});
