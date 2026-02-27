/**
 * GoldfishDB collection schemas for helios persistence.
 *
 * Phase 1: Type definitions only. These will be registered with the DB
 * and wired into the runtime in Phase 2.
 */

export type HeliosSettingsDocument = {
  rendererEngine: "ghostty" | "rio";
  hotSwapPreferred: boolean;
};

export type HeliosWorkspaceDocument = {
  name: string;
  activeLaneIds: string[];
  createdAt: string;
};

export type HeliosLaneDocument = {
  workspaceId: string;
  laneId: string;
  sessionId: string | null;
  terminalId: string | null;
  transport: string;
  state: string;
  lastUpdated: string;
};

export type HeliosAuditDocument = {
  timestamp: string;
  action: string;
  workspaceId: string;
  laneId: string | null;
  sessionId: string | null;
  detail: string;
};

/** Collection names for use with GoldfishDB */
export const HELIOS_COLLECTIONS = {
  settings: "helios_settings",
  workspaces: "helios_workspaces",
  lanes: "helios_lanes",
  audit: "helios_audit",
} as const;
