import {
  Bell,
  Boxes,
  Database,
  FileCode,
  FolderGit2,
  Gauge,
  GitBranch,
  HardDrive,
  History,
  House,
  KeyRound,
  Layers,
  Lock,
  Package,
  Play,
  Plus,
  Puzzle,
  Route,
  ScrollText,
  Settings,
  ShieldAlert,
  Stethoscope,
  Terminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";

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
};

type NavDef = {
  path: string;
  label: string;
  icon: LucideIcon;
  /** The plan phase that builds the page; absent once the page is built. */
  phase?: string;
  empty?: Empty;
};

export type NavItem = NavDef & {
  /** The group's name, used in the breadcrumb. */
  group: string;
  /** For a sub-page: the parent page's label, shown in the breadcrumb. */
  parent?: string;
  /** Sub-pages, listed under this item in the expanded sidebar. */
  children?: NavItem[];
};

type GroupDef = { name: string; items: NavDef[] };
export type NavGroup = { name: string; items: NavItem[] };

const GUIDE = "https://github.com/shadovxw/devdeck#readme";

// The one place that lists pages. The dock, the router, the breadcrumbs and
// every placeholder are built from it (the same idea as ui-mockup/nav.js).
// To add a page: add an entry here.
const GROUPS: GroupDef[] = [
  {
    name: "Workspace",
    items: [
      {
        path: "/",
        label: "Home",
        icon: House,
        phase: "Phase 1",
        empty: {
          headline: "Your workspace is ready to connect",
          text: "Start a stack to bring your services, logs, and resources into one view.",
          cta: { label: "Configure workspace", icon: Settings, to: "/workspaces" },
          secondary: { label: "View setup guide", href: GUIDE },
        },
      },
      {
        path: "/workspaces",
        label: "Workspaces",
        icon: Boxes,
        empty: {
          headline: "No workspace yet",
          text: "Point devdeck at a folder of repositories to create your first workspace.",
          cta: { label: "Add workspace" },
        },
      },
    ],
  },
  {
    name: "Code",
    items: [
      {
        path: "/repos",
        label: "Repositories",
        icon: FolderGit2,
        phase: "Phase 4",
        empty: {
          headline: "No repository connected yet",
          text: "Connect a GitHub account, then pick the repositories this workspace uses.",
          cta: { label: "Connect repository", to: "/connections" },
        },
      },
      {
        path: "/work-items",
        label: "Work items",
        icon: GitBranch,
        phase: "Phase 10",
        empty: {
          headline: "No work items yet",
          text: "Plan a feature or a fix, let Claude draft it, and open reviewed pull requests.",
          cta: { label: "New work item" },
        },
      },
    ],
  },
  {
    name: "Run locally",
    items: [
      {
        path: "/stacks",
        label: "Stacks",
        icon: Layers,
        phase: "Phase 2",
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
        phase: "Phase 3",
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
        },
      },
    ],
  },
  {
    name: "Data",
    items: [
      {
        path: "/databases",
        label: "Databases",
        icon: Database,
        phase: "Phase 6",
        empty: {
          headline: "No database connected yet",
          text: "Add a connection to browse tables, run SQL and apply migrations.",
          cta: { label: "Add connection", to: "/connections" },
        },
      },
      {
        path: "/migrations",
        label: "Migrations",
        icon: History,
        phase: "Phase 6",
        empty: {
          headline: "No migrations tracked yet",
          text: "Connect a database and point devdeck at your migration folder.",
        },
      },
      {
        path: "/sql",
        label: "SQL console",
        icon: Terminal,
        phase: "Phase 6",
        empty: {
          headline: "No database selected",
          text: "Connect a database to open a SQL console with history and saved scripts.",
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
    ],
  },
  {
    name: "Pipelines",
    items: [
      {
        path: "/flows",
        label: "Flows",
        icon: Workflow,
        phase: "Phase 7",
        empty: {
          headline: "No flows yet",
          text: "Chain checks, builds and scans into a flow you can run again and again.",
          cta: { label: "Create flow" },
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
        },
      },
      {
        path: "/findings",
        label: "Findings",
        icon: ShieldAlert,
        phase: "Phase 8",
        empty: {
          headline: "No findings yet",
          text: "Results from security and quality scanners are merged into one list.",
        },
      },
      {
        path: "/images",
        label: "Images and tags",
        icon: Package,
        phase: "Phase 9",
        empty: {
          headline: "No images yet",
          text: "Build, scan and push Docker images with automatic version tags.",
          cta: { label: "Build image" },
        },
      },
    ],
  },
  {
    name: "Explore",
    items: [
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
      {
        path: "/secrets",
        label: "Secrets",
        icon: Lock,
        phase: "Later",
        empty: {
          headline: "No secrets store connected yet",
          text: "Connect a secrets manager to browse secret names. Values are never shown or sent anywhere.",
          cta: { label: "Add connection", to: "/connections" },
        },
      },
    ],
  },
  {
    name: "Platform",
    items: [
      { path: "/plugins", label: "Plugins", icon: Puzzle },
      {
        path: "/connections",
        label: "Connections",
        icon: KeyRound,
        phase: "Phase 4",
        empty: {
          headline: "No connections yet",
          text: "Add GitHub accounts, registries and databases. Secrets stay in your OS keychain.",
          cta: { label: "Add connection", icon: Plus },
        },
      },
      {
        path: "/notifications",
        label: "Notifications",
        icon: Bell,
        phase: "Phase 5",
        empty: {
          headline: "No notification channels yet",
          text: "Get an alert when a service goes down or a build fails.",
          cta: { label: "Add channel" },
        },
      },
      {
        path: "/doctor",
        label: "Doctor",
        icon: Stethoscope,
        phase: "Phase 2",
        empty: {
          headline: "Nothing checked yet",
          text: "Check that your machine has everything a workspace needs. Tool status is already on the Plugins page.",
          cta: { label: "See tool status", icon: Puzzle, to: "/plugins" },
        },
      },
      {
        path: "/settings",
        label: "Settings",
        icon: Settings,
        phase: "Phase 13",
        empty: {
          headline: "More settings are coming",
          text: "The theme switch is in the top bar. Everything else arrives in a later phase.",
        },
      },
    ],
  },
];

// Pages that sit under another page in the sidebar. Both are still real routes:
// the parent's chevron opens the list, clicking the parent's name opens its page.
const NESTED: Record<string, string[]> = {
  "/databases": ["/migrations", "/sql", "/scripts"],
  "/flows": ["/runs"],
};
const nestedPaths = new Set(Object.values(NESTED).flat());

export const NAV: NavGroup[] = GROUPS.map((g) => {
  const byPath = new Map(g.items.map((i) => [i.path, i]));
  const items = g.items
    .filter((i) => !nestedPaths.has(i.path))
    .map((i): NavItem => {
      const children = (NESTED[i.path] ?? []).map((path): NavItem => {
        const child = byPath.get(path);
        if (!child) throw new Error(`nav: ${path} is nested under ${i.path} but is not in group ${g.name}`);
        return { ...child, group: g.name, parent: i.label };
      });
      return { ...i, group: g.name, children: children.length > 0 ? children : undefined };
    });
  return { name: g.name, items };
});

/** Every page, parents and sub-pages alike. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));

export const navByPath = (path: string): NavItem => {
  const item = NAV_ITEMS.find((i) => i.path === path);
  if (!item) throw new Error(`no nav entry for ${path}`);
  return item;
};
