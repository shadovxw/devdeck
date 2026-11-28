import { describe, expect, it } from "vitest";

import { NAME_PATTERN, nameFrom, projectYaml, rootOf, yamlValue } from "./new-project";

describe("nameFrom", () => {
  it.each([
    ["code", "code"],
    ["My Shop", "my-shop"],
    ["PROJECTS", "projects"],
    ["2024 work", "work"],
    ["___", "project"],
    ["a".repeat(60), "a".repeat(40)],
  ])("%s → %s", (raw, want) => {
    expect(nameFrom(raw)).toBe(want);
    expect(NAME_PATTERN.test(nameFrom(raw))).toBe(true);
  });
});

describe("rootOf", () => {
  it("takes the folder as the scan's draft wrote it, else the absolute path", () => {
    expect(rootOf({ root: "/home/me/code", yaml: "version: 1\nname: code\nroot: ~/code\n" })).toBe("~/code");
    expect(rootOf({ root: "/home/me/code", yaml: "" })).toBe("/home/me/code");
  });
});

describe("yamlValue", () => {
  it.each([
    ["api", "api"],
    ["SECRET SANTA", "SECRET SANTA"],
    ["~/code/acme-shop", "~/code/acme-shop"],
    ["github.com/acme/api", "github.com/acme/api"],
    ["a: b", '"a: b"'],
    ["#tag", '"#tag"'],
    ["", '""'],
    ["trailing ", '"trailing "'],
  ])("%s → %s", (v, want) => {
    expect(yamlValue(v)).toBe(want);
  });
});

describe("projectYaml", () => {
  it("writes the chosen repos with their type and remote", () => {
    const text = projectYaml({
      name: "shop",
      root: "~/code/shop",
      repos: [
        { id: "api", path: "api", type: "go", remote: "github.com/acme/api" },
        { id: "docs", path: "My Docs" },
      ],
    });
    expect(text).toBe(
      "# Made by devdeck from ~/code/shop. Edit freely.\nversion: 1\nname: shop\nroot: ~/code/shop\nrepos:\n  - id: api\n    path: api\n    type: go\n    remote: github.com/acme/api\n  - id: docs\n    path: My Docs\n",
    );
  });

  it("leaves repos out when none is chosen", () => {
    expect(projectYaml({ name: "solo", root: "~/code/solo", repos: [] })).not.toContain("repos:");
  });
});
