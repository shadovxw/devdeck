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
