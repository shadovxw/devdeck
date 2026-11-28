import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { useWorkspace } from "../../lib/queries";
import { Settings } from "../workspaces/WorkspaceDetail";
import { cleanPath } from "./PosterSetting";

// A flow list and an aligned comment: both would change if the whole file were written again.
const original = "version: 1\nname: demo   # ours\nroot: ~/code\ntags: [a, b]\n";
const UNC = "\\\\host\\share\\a.png";

/** A server with one project file: it refuses a save over a version it no longer has. */
function server(mine: boolean) {
  const state = { yaml: original, version: 1, bases: [] as string[] };
  const hash = () => `h${state.version}`;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const json = (data: unknown, status = 200) => Promise.resolve(Response.json(data, { status }));
      if (url === "/api/v1/workspaces/demo" && method === "PUT") {
        state.bases.push(body.base_hash);
        if (body.base_hash !== hash()) return json({ message: "the file changed on disk", yaml: state.yaml, hash: hash() }, 409);
        state.yaml = body.yaml;
        state.version++;
        return json({ id: "demo", hash: hash() });
      }
      if (url === "/api/v1/workspaces/demo") {
        const poster: string | undefined = parse(state.yaml).poster;
        return json({
          id: "demo",
          name: "demo",
          source: mine ? "local" : "example",
          repos: 0,
          errors: 0,
          warnings: 0,
          poster_url: poster ? `/api/v1/workspaces/demo/poster?v=${state.version}` : undefined,
          workspace: { name: "demo", root: "~/code", poster },
          stacks: [],
          flows: [],
          issues: [],
        });
      }
      if (url === "/api/v1/workspaces/demo/file") return json({ yaml: state.yaml, hash: hash(), path: "/w/demo/workspace.yaml", kind: "workspace" });
      if (url === "/api/v1/workspaces/validate") {
        const issue = { file: "workspace.yaml", path: "/poster", severity: "warning", message: "No network paths." };
        return json({ valid: true, issues: parse(body.yaml)?.poster === UNC ? [issue] : [] });
      }
      return json({ message: "not found" }, 404);
    }),
  );
  return state;
}

function Page({ mine }: Readonly<{ mine: boolean }>) {
  const project = useWorkspace("demo");
  return project.data ? <Settings id="demo" d={project.data} mine={mine} onDeleted={() => {}} /> : null;
}

function show(mine = true) {
  const state = server(mine);
  const router = createMemoryRouter([{ path: "/", element: <Page mine={mine} /> }]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return state;
}

async function block() {
  const poster = within(await screen.findByRole("region", { name: "Poster" }));
  const field = poster.getByRole("textbox", { name: "Poster image path" }) as HTMLInputElement;
  const save = () => poster.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  const type = (value: string) => fireEvent.change(field, { target: { value } });
  return { poster, field, save, type };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cleanPath", () => {
  it.each([
    ['"C:\\art\\a.png"', "C:\\art\\a.png"],
    ["  '~/a.svg'  ", "~/a.svg"],
    ["it's.png", "it's.png"],
    ['"unfinished.png', '"unfinished.png'],
    ["   ", ""],
  ])("%s", (from, want) => expect(cleanPath(from)).toBe(want));
});

describe("the Poster setting", () => {
  it("adds, changes and removes the poster, one save after another, changing nothing else", async () => {
    const state = show();
    const { poster, field, save, type } = await block();
    expect(poster.getByText("No poster")).toBeTruthy();
    expect(save().disabled).toBe(true);

    type('"~/art/one.svg"'); // as Windows' "Copy as path" gives it
    fireEvent.click(save());
    await waitFor(() => expect(state.yaml).toBe(`${original}poster: ~/art/one.svg\n`));
    await waitFor(() => expect(field.value).toBe("~/art/one.svg"));
    expect(poster.getByRole("img", { name: "Poster of demo" }).getAttribute("src")).toBe("/api/v1/workspaces/demo/poster?v=2");

    type("~/art/two.svg");
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(state.yaml).toBe(`${original}poster: ~/art/two.svg\n`));
    await waitFor(() => expect(field.value).toBe("~/art/two.svg"));

    await waitFor(() => expect((poster.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(poster.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(state.yaml).toBe(original));
    await waitFor(() => expect(field.value).toBe(""));
    expect(poster.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(state.bases).toEqual(["h1", "h2", "h3"]); // each save started from the one before
  });

  it("doesn't overwrite a file that changed on disk, and adds to the new one on the next save", async () => {
    const state = show();
    const { poster, field, save, type } = await block();
    state.yaml = `${original}description: edited elsewhere\n`;
    state.version = 7;

    type("a.svg");
    fireEvent.click(save());
    expect(await poster.findByText(/The file changed on disk, so nothing was written/)).toBeTruthy();
    expect(state.yaml).not.toContain("poster");
    expect(field.value).toBe("a.svg"); // what was typed is kept

    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(state.yaml).toBe(`${original}description: edited elsewhere\nposter: a.svg\n`));
  });

  it("says what is wrong with a path before it is saved", async () => {
    const state = show();
    const { poster, type } = await block();
    type(UNC);
    expect(await poster.findByText("No network paths.")).toBeTruthy();
    expect(state.bases).toEqual([]);
  });

  it("says so when the saved picture can't be shown", async () => {
    show();
    const { poster, save, type } = await block();
    type("a.svg");
    fireEvent.click(save());
    fireEvent.error(await poster.findByRole("img"));
    expect(poster.getByText("Can’t be shown")).toBeTruthy();
  });

  it("isn't there for an example", async () => {
    show(false);
    await screen.findByText("Example (read only)");
    expect(screen.queryByRole("region", { name: "Poster" })).toBeNull();
  });
});
