import {
  Bell,
  Bot,
  BookOpen,
  Boxes,
  Container,
  Database,
  FileCode,
  FolderGit2,
  Gauge,
  GitBranch,
  GitFork,
  HardDrive,
  History,
  House,
  LayoutDashboard,
  KeyRound,
  Layers,
  Lock,
  Package,
  Play,
  Plus,
  Puzzle,
  Route,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  Stethoscope,
  Terminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { MiniVariant } from "../design/orb/mini-model";

/** What an empty page says and offers. */
export type Empty = {
  headline: string;
  text: string;
  cta?: {
    label: string;
    icon?: LucideIcon;
    /** Where the button goes. Without it the button is disabled until the phase that builds the page. */
    to?: string;
  };
  secondary?: { label: string; href: string };
  /** The mono line above the headline ("00 $ LOGS · NOTHING STREAMING"). */
  kicker?: string;
  /** A real devdeck command that does the same from a terminal, shown as a chip. */
  command?: string;
  /** The mini orb's variant: what the page holds (dev-plans/2026-11-21-portfolio-look §8d). */
  orb?: MiniVariant;
};

type NavDef = {
  path: string;
  label: string;
  icon: LucideIcon;
  /** The plan phase that builds the page; absent once the page is built. A page with a phase isn't built yet, so the sidebar leaves it out (it is listed under Coming soon, or as a dimmed tab). */
  phase?: string;
  /** The page's name on its family's tab strip, when it differs from its label (Health's own tab is "Doctor"). */
  tab?: string;
  /** A few words on what the page is for, under its name on Home (the orb launcher). */
  hint?: string;
  empty?: Empty;
};

export type NavItem = NavDef & {
  /** The group's name, used in the breadcrumb. */
  group: string;
  /** For a sub-page: the parent page's label, shown in the breadcrumb. */
  parent?: string;
  /** The pages of its family (FAMILIES), shown as tabs on each of them; the sidebar lists only this one. */
  children?: NavItem[];
  /** Built: no phase. Unbuilt pages stay real routes but leave the sidebar. */
  built: boolean;
};

/** blurb: what the group is about in two or three words, on Home's legend ("what's running"). */
type GroupDef = { name: string; blurb?: string; items: NavDef[] };
/** A sidebar group. Home's group ("devdeck") has no heading; System is the footer pinned to the bottom. */
export type NavGroup = { name: string; blurb?: string; items: NavItem[] };

/** The group shown as the sidebar's footer, and the one without a heading. */
export const FOOTER_GROUP = "System";
export const HOME_GROUP = "devdeck";

const GUIDE = "https://github.com/shadovxw/devdeck#readme";

// The one place that lists pages. The dock, the router, the breadcrumbs and
// every placeholder are built from it (the same idea as ui-mockup/nav.js).
// To add a page: add an entry here.
const GROUPS: GroupDef[] = [
  {
    name: "devdeck",
    items: [
      {
        path: "/",
        label: "Home",
        icon: House,
        empty: {
          headline: "Your workspace is ready to connect",
          text: "Start a stack to bring your services, logs, and resources into one view.",
          cta: { label: "Configure workspace", icon: Settings, to: "/workspaces" },
          secondary: { label: "View setup guide", href: GUIDE },
        },
      },
      {
        path: "/overview",
        label: "Overview",
        hint: "everything at a glance",
        icon: LayoutDashboard,
        empty: {
          headline: "Nothing is running",
          text: "Start a stack and what runs, what needs a look and how long it has been up show here.",
          cta: { label: "Open stacks", icon: Layers, to: "/stacks" },
        },
      },
    ],
  },
  {
    name: "Work",
    blurb: "your code",
    items: [
      {
        path: "/workspaces",
        // A project: one repo or a folder of them, and how they run (dev-plans/2026-11-22-projects).
        // The files and the address still say workspace until PJ2 and PJ9.
        label: "Projects",
        hint: "your work, in one place",
        icon: Boxes,
        empty: {
          headline: "No projects yet",
          text: "Point devdeck at one repo, or a folder of them, to create your first project.",
          cta: { label: "New project" },
          kicker: "00 $ Projects · none yet",
          command: "devdeck workspace check <folder>",
          orb: "workspaces",
        },
      },
      {
        path: "/repos",
        label: "Repositories",
        hint: "clone, branch, sync",
        icon: FolderGit2,
        empty: {
          headline: "No repository connected yet",
          text: "Connect a GitHub account, then pick the repositories this workspace uses.",
          cta: { label: "Connect repository", to: "/connections/github" },
        },
      },
      {
        path: "/features",
        label: "Features",
        hint: "work items across repos",
        icon: GitBranch,
        empty: {
          headline: "No features yet",
          text: "Plan a feature as small stacked PRs in your plans repository, and follow each PR from here.",
          cta: { label: "Open workspaces", to: "/workspaces" },
        },
      },
    ],
  },
  {
    name: "Run",
    blurb: "what's running",
    items: [
      {
        path: "/stacks",
        label: "Stacks",
        hint: "start services together",
        icon: Layers,
        empty: {
          headline: "No stack defined yet",
          text: "A stack starts your databases, services and web apps in the right order with one click.",
          cta: { label: "Create stack" },
        },
      },
      {
        path: "/logs",
        label: "Logs",
        icon: ScrollText,
        empty: {
          headline: "No logs to show",
          text: "Start a stack and every service’s logs appear here, filterable by level, field or regex.",
        },
      },
      {
        path: "/resources",
        label: "Resources",
        icon: Gauge,
        phase: "Phase 5",
        empty: {
          headline: "Nothing running yet",
          text: "CPU, memory and disk per service show up once a stack is running.",
          kicker: "00 $ Resources · flat line",
          command: "devdeck up <stack>",
          cta: { label: "Start a stack", to: "/stacks" },
          orb: "resources",
        },
      },
      {
        path: "/images",
        label: "Images and tags",
        icon: Package,
        empty: {
          headline: "No images yet",
          text: "Build and push Docker images by typing a tag.",
          cta: { label: "Open workspaces", to: "/workspaces" },
        },
      },
      {
        path: "/hosts",
        label: "Remote hosts",
        hint: "machines over SSH",
        icon: Server,
        empty: {
          headline: "No remote host yet",
          text: "Add a host to your workspace to see its compose stacks, services and live logs through an SSM tunnel.",
        },
      },
      {
        path: "/doctor",
        label: "Health",
        hint: "Doctor and findings",
        tab: "Doctor",
        icon: Stethoscope,
        empty: {
          headline: "Nothing checked yet",
          text: "Check that your machine has everything a workspace needs. Tool status is already on the Plugins page.",
          cta: { label: "See tool status", icon: Puzzle, to: "/plugins" },
        },
      },
      {
        path: "/findings",
        label: "Findings",
        icon: ShieldAlert,
        phase: "Phase 8",
        empty: {
          headline: "All clear. Nothing to fix.",
          text: "Results from security and quality scanners are merged into one list.",
          kicker: "00 $ Findings · all clear",
          cta: { label: "Run Doctor again", to: "/doctor" },
          orb: "findings",
        },
      },
    ],
  },
  {
    name: "Data",
    blurb: "your data",
    items: [
      {
        path: "/databases",
        label: "Databases",
        icon: Database,
        phase: "Phase 6",
        empty: {
          headline: "No database connected",
          text: "Add a connection to browse tables, run SQL and apply migrations.",
          cta: { label: "Add connection", to: "/connections" },
          kicker: "00 $ Databases · none connected",
          orb: "data",
        },
      },
      {
        path: "/migrations",
        label: "Migrations",
        icon: History,
        phase: "Phase 6",
        empty: {
          headline: "No database connected",
          text: "Connect a database and point devdeck at your migration folder.",
          cta: { label: "Add connection", to: "/connections" },
          kicker: "00 $ Migrations · nothing tracked",
          orb: "data",
        },
      },
      {
        path: "/sql",
        label: "SQL console",
        icon: Terminal,
        phase: "Phase 6",
        empty: {
          headline: "No database connected",
          text: "Connect a database to open a SQL console with history and saved scripts.",
          cta: { label: "Add connection", to: "/connections" },
          kicker: "00 $ SQL · no database",
          orb: "data",
        },
      },
      {
        path: "/scripts",
        label: "Saved scripts",
        icon: FileCode,
        phase: "Phase 6",
        empty: {
          headline: "No saved scripts yet",
          text: "Scripts you save from the SQL console are kept here with their parameters.",
        },
      },
      {
        path: "/storage",
        label: "Storage",
        icon: HardDrive,
        phase: "Later",
        empty: {
          headline: "No storage connected yet",
          text: "Connect an S3-compatible store to browse buckets and objects.",
          cta: { label: "Add connection", to: "/connections" },
        },
      },
    ],
  },
  {
    name: "Automate",
    blurb: "flows and runs",
    items: [
      {
        path: "/flows",
        label: "Flows",
        icon: Workflow,
        phase: "Phase 7",
        empty: {
          headline: "No flows yet",
          text: "Chain checks, builds and scans into a flow you can run again and again.",
          cta: { label: "New flow" },
          kicker: "00 $ Flows · none yet",
          command: "devdeck schema flow",
          orb: "flows",
        },
      },
      {
        path: "/runs",
        label: "Runs",
        icon: Play,
        phase: "Phase 7",
        empty: {
          headline: "No runs yet",
          text: "Every flow run is recorded here with its steps, timings and output.",
          cta: { label: "Run one", to: "/flows" },
          kicker: "00 $ Runs · none today",
          orb: "flows",
        },
      },
      {
        path: "/flow-trace",
        label: "Flow trace",
        icon: Route,
        phase: "Later",
        empty: {
          headline: "No trace loaded",
          text: "Follow a request across your services to see where the time and the errors go.",
        },
      },
    ],
  },
  {
    name: "System",
    blurb: "setup",
    items: [
      {
        path: "/connections",
        label: "Connections",
        hint: "GitHub, Docker Hub, Claude",
        icon: KeyRound,
        empty: {
          headline: "No connections yet",
          text: "Add GitHub accounts, registries and databases. Secrets stay in your OS keychain.",
          cta: { label: "Add connection", icon: Plus },
        },
      },
      {
        path: "/connections/github",
        label: "GitHub",
        icon: GitFork,
        empty: {
          headline: "No GitHub account yet",
          text: "Sign in with the GitHub CLI, then add a connection for each account you use.",
          cta: { label: "Back to Connections", to: "/connections" },
        },
      },
      {
        path: "/connections/docker",
        label: "Docker Hub",
        icon: Container,
        empty: {
          headline: "No Docker Hub account yet",
          text: "Add an account and its access token to push images. The token stays in your OS keychain.",
          cta: { label: "Back to Connections", to: "/connections" },
        },
      },
      {
        path: "/claude",
        label: "Claude access",
        icon: Bot,
        empty: {
          headline: "Claude hasn’t asked yet",
          text: "Connect Claude Code to let it read your stacks and logs. It can only read.",
        },
      },
      {
        path: "/secrets",
        label: "Secrets",
        icon: Lock,
        phase: "Later",
        empty: {
          headline: "No secrets stored",
          text: "Connect a secrets manager to browse secret names. Values are never shown or sent anywhere.",
          cta: { label: "Add secret", to: "/connections" },
          kicker: "00 $ Secrets · none stored",
          orb: "secrets",
        },
      },
      { path: "/plugins", label: "Plugins", hint: "extend devdeck", icon: Puzzle },
      {
        path: "/notifications",
        label: "Notifications",
        icon: Bell,
        phase: "Phase 5",
        empty: {
          headline: "You're caught up",
          text: "Get an alert when a service goes down or a build fails.",
          kicker: "00 $ Notifications · nothing new",
          orb: "notifications",
        },
      },
      {
        path: "/docs",
        label: "Docs",
        hint: "guides and reference",
        icon: BookOpen,
        empty: {
          headline: "No guides",
          text: "The guides that come with devdeck are listed here.",
        },
      },
      {
        path: "/settings",
        label: "Settings",
        hint: "look, shortcuts, about",
        icon: Settings,
        empty: {
          headline: "More settings are coming",
          text: "Appearance is here. Everything else arrives in a later phase.",
        },
      },
    ],
  },
];

// Families: a page and the pages that belong to it. The sidebar lists only the first; all of
// them show as tabs under the page title (design/PageHeader). Every one is still its own route.
// A family stays inside one group.
const FAMILIES: Record<string, string[]> = {
  "/stacks": ["/logs", "/resources", "/images"],
  "/databases": ["/migrations", "/sql", "/scripts"],
  "/flows": ["/runs", "/flow-trace"],
  "/doctor": ["/findings"],
  "/connections": ["/connections/github", "/connections/docker", "/claude"],
};
const nestedPaths = new Set(Object.values(FAMILIES).flat());

export const NAV: NavGroup[] = GROUPS.map((g) => {
  const byPath = new Map(g.items.map((i) => [i.path, i]));
  const items = g.items
    .filter((i) => !nestedPaths.has(i.path))
    .map((i): NavItem => {
      const children = (FAMILIES[i.path] ?? []).map((path): NavItem => {
        const child = byPath.get(path);
        if (!child) throw new Error(`nav: ${path} is nested under ${i.path} but is not in group ${g.name}`);
        return { ...child, group: g.name, parent: i.label, built: !child.phase };
      });
      return { ...i, group: g.name, children: children.length > 0 ? children : undefined, built: !i.phase };
    });
  return { name: g.name, blurb: g.blurb, items };
});

/** Every page, parents and sub-pages alike. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));

/**
 * The family a page belongs to, parent first: what its tab strip shows. Undefined for a page
 * with no family.
 */
export function familyOf(path: string): NavItem[] | undefined {
  for (const g of NAV) {
    for (const i of g.items) {
      if (!i.children) continue;
      if (i.path === path || i.children.some((c) => c.path === path)) return [i, ...i.children];
    }
  }
  return undefined;
}

/** The sidebar item a page is shown under: itself, or its family's first page. */
export const sidebarPathOf = (path: string): string => {
  const family = familyOf(path)?.[0].path;
  if (family) return family;
  if (NAV_ITEMS.some((i) => i.path === path)) return path;
  // A page under a listed one (a project's own page, /workspaces/acme) shows under it.
  return NAV_ITEMS.find((i) => i.path !== "/" && path.startsWith(i.path + "/"))?.path ?? path;
};

export const navByPath = (path: string): NavItem => {
  const item = NAV_ITEMS.find((i) => i.path === path);
  if (!item) throw new Error(`no nav entry for ${path}`);
  return item;
};
