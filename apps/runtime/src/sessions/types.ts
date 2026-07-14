export type RecoveryLaneRecord = {
  lane_id: string;
  workspace_id: string;
  session_id?: string;
  terminal_id?: string;
};

export type RecoverySessionRecord = {
  session_id: string;
  workspace_id: string;
  lane_id?: string;
  codex_session_id?: string;
  terminal_id?: string;
  status: "attached" | "detached" | "terminated";
};

export type RecoveryTerminalRecord = {
  terminal_id: string;
  workspace_id: string;
  lane_id?: string;
  session_id?: string;
  status: "active" | "stopped" | "errored";
};

export type RecoveryMetadata = {
  lanes: RecoveryLaneRecord[];
  sessions: RecoverySessionRecord[];
  terminals: RecoveryTerminalRecord[];
};

export type RecoveryIssue = {
  artifact_type: "lane" | "session" | "terminal";
  artifact_id: string;
  state: "recoverable" | "unrecoverable";
  reason: string;
  remediation: "reattach" | "cleanup" | "reconcile";
};

export type RecoveryBootstrapResult = {
  recovered_session_ids: string[];
  issues: RecoveryIssue[];
};

export type WatchdogScanResult = {
  scanned_at: string;
  issues: RecoveryIssue[];
};
