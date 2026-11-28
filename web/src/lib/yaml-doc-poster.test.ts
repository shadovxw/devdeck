import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { setPoster } from "./yaml-doc";

// Everything here would be respaced by writing the whole document again.
const rest = 'name: acme   # ours\nrun:\n  needs: [db, cache]\n  env: {PORT: "3000"}\n';

describe("setPoster", () => {
  it.each([
    { name: "adds the line at the end", from: rest, path: "~/a.svg", want: `${rest}poster: ~/a.svg\n` },
    { name: "adds a line break first when there is none", from: "name: acme", path: "a.png", want: "name: acme\nposter: a.png\n" },
    { name: "keeps Windows line endings", from: "name: acme\r\n", path: "a.png", want: "name: acme\r\nposter: a.png\r\n" },
    { name: "changes only the value, keeping its comment", from: `poster: old.png # art\n${rest}`, path: "new.png", want: `poster: new.png # art\n${rest}` },
    { name: "fills an empty line", from: "poster:\nname: acme\n", path: "a.png", want: "poster: a.png\nname: acme\n" },
    { name: "replaces a block value", from: `poster: >-\n  old.png\n${rest}`, path: "new.png", want: `poster: new.png\n${rest}` },
    { name: "removes the line and its comment", from: "name: a\nposter: old.png # art\nroot: b\n", path: "", want: "name: a\nroot: b\n" },
    { name: "removes a last line with no line break", from: "name: a\nposter: old.png", path: "", want: "name: a\n" },
    { name: "removes a line with Windows endings", from: "name: a\r\nposter: old.png\r\nroot: b\r\n", path: "", want: "name: a\r\nroot: b\r\n" },
    { name: "removes a block value", from: `poster: >-\n  old.png\n${rest}`, path: "", want: rest },
    { name: "removes an empty line", from: "poster:\nname: acme\n", path: "", want: "name: acme\n" },
    { name: "has nothing to remove", from: rest, path: "", want: rest },
    { name: "leaves text it can't read", from: "name: [", path: "a.png", want: "name: [" },
  ])("$name", ({ from, path, want }) => {
    expect(setPoster(from, path)).toBe(want);
  });

  it.each(["C:\\Users\\me\\My Art\\a #1.png", "it's: here.svg", "123", "[a].png", "~", "null"])("writes %s so that it reads back the same", (path) => {
    const out = setPoster(rest, path);
    expect(parse(out).poster).toBe(path);
    expect(out.startsWith(rest)).toBe(true);
  });
});
