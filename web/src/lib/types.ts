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
  group: "tools" | "repos" | "stacks" | "git" | "hosts" | "claude";
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
  compose?: Array<{ id?: string; repo: string; file: string; services?: string[]; after?: string[]; optional?: boolean }>;
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
  /** A compose file whose failure holds nothing back. */
  optional?: boolean;
  /** The host ports a compose file's containers publish. */
  ports?: number[];
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

/** What the server answers when a stack file is saved: where it went, and warnings found in it. */
export type StackSaved = { name: string; file: string; issues: Issue[] };

// Service logs (internal/logs).

/** One stored line of a service's output. */
export type LogEntry = {
  seq: number;
  time: string;
  workspace: string;
  stack: string;
  /** The service id, or "<compose file id>/<container service>". */
  service: string;
  stream: string;
  text: string;
  truncated?: number;
  /** Read when the line arrived: trace, debug, info, warn, error or fatal. */
  level?: LogLevel;
  /** The human part of a structured line, or the first line of a panic. Empty for plain text. */
  message?: string;
  /** "file:line" of the code that logged it, when the line says so. */
  caller?: string;
  /** The other values of a structured line. */
  fields?: Record<string, unknown>;
  /** The same for the same kind of error; only error and fatal entries have one. */
  fingerprint?: string;
};

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** How many entries of each level matched a query, over time (GET .../logs/histogram). */
export type LogHistogram = {
  from: string;
  to: string;
  bucket_seconds: number;
  total: number;
  buckets: { t: string; counts: Partial<Record<LogLevel, number>> }[];
};

/** One kind of error seen in a stack. */
export type LogGroup = {
  fingerprint: string;
  service: string;
  level: LogLevel;
  message: string;
  caller?: string;
  count: number;
  first_seen: string;
  last_seen: string;
  sample_seq: number;
};

/** What the live topic "logs.<workspace>.<stack>" carries. */
export type LogBatch = { workspace: string; stack: string; from_seq: number; to_seq: number; entries: LogEntry[] };

export type LogsPage = { entries: LogEntry[]; next_before?: number };

/** Which of a service's lines are stored: all, only those matching a pattern, or none. */
export type CaptureRule = { store: "all" | "matching" | "off"; match?: string; parser?: "auto" | "zerolog" | "go-panic" | "vite-log" | "plain" };

export type CaptureInfo = CaptureRule & { service: string; source: "default" | "file" | "override" };
