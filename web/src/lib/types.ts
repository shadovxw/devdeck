// Shapes returned by the Go server (internal/api, sdk). Keep in step with the
// JSON tags there.

export type Health = { status: string; version: string };

export type ToolState = "ok" | "missing" | "outdated" | "degraded";

export type ToolStatus = {
  state: ToolState;
  version?: string;
  detail?: string;
  checked_at: string;
};

export type InstallMethod = { method: string; command: string };

export type Need = {
  binary: string;
  version_args?: string[];
  min_version?: string;
  install?: InstallMethod[];
};

export type Plugin = {
  id: string;
  name: string;
  category: string;
  icon?: string;
  description?: string;
  needs?: Need[];
  status: ToolStatus;
};

// Workspace config (internal/workspace).

export type Severity = "error" | "warning";

/** One problem found in a config file. `line` is 1-based and absent when unknown. */
export type Issue = {
  file: string;
  path?: string;
  line?: number;
  severity: Severity;
  message: string;
};

export type Repo = { id: string; path: string; type?: string; remote?: string; connection?: string };

export type WorkspaceSummary = {
  id: string;
  name: string;
  description?: string;
  source: "local" | "example";
  root?: string;
  repos: number;
  stacks: number;
  flows: number;
  errors: number;
  warnings: number;
};

export type WorkspaceDetail = Omit<WorkspaceSummary, "stacks" | "flows"> & {
  workspace?: { name: string; root: string; repos?: Repo[] };
  stacks: StackDef[];
  flows: Array<{ name: string; description?: string }>;
  issues: Issue[];
};

export type ScanResult = { root: string; name: string; repos: Repo[]; yaml: string; truncated?: boolean };

export type Validation = { valid: boolean; issues: Issue[] };

// Doctor (internal/doctor).

export type CheckStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  id: string;
  group: "tools" | "repos" | "stacks" | "git";
  title: string;
  status: CheckStatus;
  detail?: string;
  /** What to do about it: commands to run, a link, or a sentence. */
  fix?: string[];
  stack?: string;
};

export type DoctorReport = {
  workspace: string;
  stack?: string;
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failures: number;
  checked_at: string;
};

// Stacks and the supervisor (internal/workspace, internal/supervisor).

/** A stack as written in its file. */
export type StackDef = {
  name: string;
  description?: string;
  compose?: Array<{ repo: string; file: string; services?: string[] }>;
  services?: Array<{ id: string; kind: string; port?: number; after?: string[] }>;
};

export type ServiceState =
  | "waiting"
  | "building"
  | "starting"
  | "ready"
  | "restarting"
  | "failed"
  | "blocked"
  | "stopping"
  | "stopped";

export type RunState = "starting" | "running" | "degraded" | "stopping" | "stopped";

export type ServiceStatus = {
  id: string;
  kind: string;
  state: ServiceState;
  port?: number;
  restarts: number;
  started_at?: string;
  ready_at?: string;
  last_error?: string;
  exit_code?: number;
};

export type RunStatus = {
  workspace: string;
  stack: string;
  state: RunState;
  started_at: string;
  services: ServiceStatus[];
};

/** The body of a 422 from starting a stack when the machine isn't ready. */
export type StartRefusal = { message: string; report?: DoctorReport };
