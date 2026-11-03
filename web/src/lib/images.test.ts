import { describe, expect, it } from "vitest";

import type { ImageRow } from "./docker";
import { buildCommand, filterImages, formatBytes, imageKey, noImageFilter, sortImages, summarize } from "./images";

const row = (over: Partial<ImageRow> = {}): ImageRow => ({
  workspace: "demo",
  workspace_name: "demo",
  repo: "api",
  image: "api",
  repository: "acme/demo-api",
  dockerfile: "Dockerfile",
  context: ".",
  platforms: [],
  path: "/code/api",
  secrets: [],
  dirty: false,
  folder_missing: false,
  ...over,
});

describe("formatBytes", () => {
  it.each([
    [undefined, ""],
    [0, ""],
    [512, "512 B"],
    [88_000, "88 KB"],
    [1_500_000, "1.5 MB"],
    [412_000_000, "412 MB"],
    [2_300_000_000, "2.3 GB"],
  ])("%j → %j", (n, want) => {
    expect(formatBytes(n)).toBe(want);
  });
});

describe("buildCommand", () => {
  it("is the buildx command for the tag, with each secret as an environment variable", () => {
    const r = row({ secrets: [{ id: "gh_token", from: "github" }] });
    expect(buildCommand(r, "1.0.4")).toBe("cd /code/api\ndocker buildx build -t acme/demo-api:1.0.4 --secret id=gh_token,env=GH_TOKEN --push .");
  });
  it("names a platform only when the workspace file sets one, and a Dockerfile that isn't the default, several platforms, and quotes paths with spaces", () => {
    const r = row({ path: "C:\\my code\\api", dockerfile: "docker/Dockerfile.prod", context: "..", platforms: ["linux/amd64", "linux/arm64"] });
    expect(buildCommand(r, "")).toBe('cd "C:\\my code\\api"\ndocker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile.prod -t acme/demo-api:<tag> --push ..');
  });
});

describe("filter, sort and summary", () => {
  const ok = { id: 1, at: "", workspace: "demo", repo: "x", image: "x", repository: "r", tag: "1", dirty: false, account: "w", ok: true, seconds: 1 };
  const rows = [
    row({ image: "auth", repo: "auth", repository: "acme/auth", branch: "feature-x", ahead: 3, last: ok }),
    row({ image: "billing", repo: "billing", repository: "acme/billing", ahead: 0, last: ok }),
    row({ image: "catalog", repo: "catalog", repository: "acme/catalog", dirty: true }),
    row({ image: "docs", repo: "docs", repository: "acme/docs", ahead: 7, last: { ...ok, ok: false } }),
  ];
  const names = (f: Partial<typeof noImageFilter>) => filterImages(rows, { ...noImageFilter, ...f }).map((r) => r.image);

  it("filters by text in the names or the branch, and by chip", () => {
    expect(names({})).toEqual(["auth", "billing", "catalog", "docs"]);
    expect(names({ text: " FEATURE " })).toEqual(["auth"]);
    expect(names({ text: "acme/b" })).toEqual(["billing"]);
    expect(names({ chip: "ahead" })).toEqual(["auth", "docs"]);
    expect(names({ chip: "dirty" })).toEqual(["catalog"]);
    expect(names({ chip: "never" })).toEqual(["catalog"]);
  });

  it("puts the images with the most commits since their last build first", () => {
    expect(sortImages(rows).map((r) => r.image)).toEqual(["docs", "auth", "billing", "catalog"]);
  });

  it("counts what is up to date and what is ahead", () => {
    expect(summarize(rows)).toEqual({ total: 4, upToDate: 1, ahead: 2, workspaces: 1 });
  });

  it("keys an image by workspace, repo and image", () => {
    expect(imageKey(rows[0])).toBe("demo/auth/auth");
  });
});
