import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

/** One guide in the list: its id (its file name without .md) and its title. */
export type DocEntry = { id: string; title: string };

/** The guides built into the program. */
export function useDocs() {
  return useQuery({ queryKey: ["docs"], queryFn: ({ signal }) => api.get<DocEntry[]>("/docs", signal), staleTime: Infinity });
}

/** One guide, as Markdown. */
export function useDoc(id: string | undefined) {
  return useQuery({
    queryKey: ["docs", id],
    enabled: id !== undefined,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/v1/docs/${encodeURIComponent(id ?? "")}`, { signal, headers: { Accept: "text/markdown" } });
      if (!res.ok) throw new Error(res.status === 404 ? "This guide doesn’t exist." : `The guide couldn’t be read (HTTP ${res.status}).`);
      return res.text();
    },
  });
}

export type DocLink = { kind: "doc"; to: string } | { kind: "external"; href: string } | { kind: "anchor"; href: string } | { kind: "none" };

/**
 * Where a link in a guide goes. A link to another guide (`teammate-setup.md`) opens it in the app; a web address opens
 * in a new tab; `#section` stays on the page; a path into the repository (`../dev-plans/...`) has nowhere to go here,
 * so it is shown as plain text.
 */
export function docLink(href: string | undefined, ids: string[]): DocLink {
  if (!href) return { kind: "none" };
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^https?:\/\//i.test(href)) return { kind: "external", href };
  const m = /^(?:\.\/)?([a-z][a-z0-9-]*)\.md(#.*)?$/.exec(href);
  if (m && ids.includes(m[1])) return { kind: "doc", to: `/docs/${m[1]}${m[2] ?? ""}` };
  return { kind: "none" };
}
