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
  stacks: Array<{ name: string; description?: string }>;
  flows: Array<{ name: string; description?: string }>;
  issues: Issue[];
};

export type ScanResult = { root: string; name: string; repos: Repo[]; yaml: string; truncated?: boolean };

export type Validation = { valid: boolean; issues: Issue[] };
