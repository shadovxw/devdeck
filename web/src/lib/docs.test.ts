import { describe, expect, it } from "vitest";

import { docLink } from "./docs";

const ids = ["teammate-setup", "docker-builds"];

describe("docLink", () => {
  it.each([
    ["teammate-setup.md", { kind: "doc", to: "/docs/teammate-setup" }],
    ["./docker-builds.md#build-secrets", { kind: "doc", to: "/docs/docker-builds#build-secrets" }],
    ["https://hub.docker.com/", { kind: "external", href: "https://hub.docker.com/" }],
    ["#which-account-pushes", { kind: "anchor", href: "#which-account-pushes" }],
    ["unknown-guide.md", { kind: "none" }], // not one of the guides built in
    ["../dev-plans/2026-10-24-remote-agent/plan.md", { kind: "none" }], // a path in the repository
    ["javascript:alert(1)", { kind: "none" }],
    ["", { kind: "none" }],
    [undefined, { kind: "none" }],
  ])("%j", (href, want) => {
    expect(docLink(href, ids)).toEqual(want);
  });
});
