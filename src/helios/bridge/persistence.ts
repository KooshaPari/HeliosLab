/**
 * GoldfishDB persistence adapter for helios.
 *
 * Reads/writes helios lane state and audit entries to the shared
 * co(lab) database. Settings are persisted as a singleton document.
 */

import db from "../../main/goldfishdb/db";
import type { BusLaneState } from "../runtime/protocol/bus";

// ── Settings ───────────────────────────────────────────

export interface HeliosSettings {
  rendererEngine: "ghostty" | "rio";
  hotSwapPreferred: boolean;
}

const DEFAULT_SETTINGS: HeliosSettings = {
  rendererEngine: "ghostty",
  hotSwapPreferred: true,
};

let settingsDocId: string | null = null;

export function loadSettings(): HeliosSettings {
  const { data } = db.collection("helios_settings").query();
  if (data.length > 0) {
    settingsDocId = data[0].id;
    return {
      rendererEngine:
        (data[0].rendererEngine as "ghostty" | "rio") ?? DEFAULT_SETTINGS.rendererEngine,
      hotSwapPreferred: data[0].hotSwapPreferred ?? DEFAULT_SETTINGS.hotSwapPreferred,
    };
  }
  // Insert default settings
  const doc = db.collection("helios_settings").insert({
    rendererEngine: DEFAULT_SETTINGS.rendererEngine,
    hotSwapPreferred: DEFAULT_SETTINGS.hotSwapPreferred,
  });
  settingsDocId = doc.id;
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: HeliosSettings): void {
  if (!settingsDocId) {
    loadSettings();
  }
  if (settingsDocId) {
    db.collection("helios_settings").update(settingsDocId, {
      rendererEngine: settings.rendererEngine,
      hotSwapPreferred: settings.hotSwapPreferred,
    });
  }
}

// ── Lanes ──────────────────────────────────────────────

export interface PersistedLane {
  id: string;
  workspaceId: string;
  laneId: string;
  sessionId: string | null;
  terminalId: string | null;
  transport: string;
  state: string;
  lastUpdated: string;
}

export function upsertLane(lane: Omit<PersistedLane, "id">): PersistedLane {
  const { data } = db.collection("helios_lanes").query();
  const existing = data.find((d) => d.laneId === lane.laneId);

  if (existing) {
    const updated = db.collection("helios_lanes").update(existing.id, {
      sessionId: lane.sessionId ?? undefined,
      terminalId: lane.terminalId ?? undefined,
      transport: lane.transport,
      state: lane.state,
      lastUpdated: lane.lastUpdated,
    });
    return {
      ...updated,
      sessionId: updated.sessionId ?? null,
      terminalId: updated.terminalId ?? null,
    } as PersistedLane;
  }

  const doc = db.collection("helios_lanes").insert({
    workspaceId: lane.workspaceId,
    laneId: lane.laneId,
    sessionId: lane.sessionId ?? undefined,
    terminalId: lane.terminalId ?? undefined,
    transport: lane.transport,
    state: lane.state,
    lastUpdated: lane.lastUpdated,
  });
  return {
    ...doc,
    sessionId: doc.sessionId ?? null,
    terminalId: doc.terminalId ?? null,
  } as PersistedLane;
}

export function getLanesForWorkspace(workspaceId: string): PersistedLane[] {
  const { data } = db.collection("helios_lanes").query();
  return data
    .filter((d) => d.workspaceId === workspaceId)
    .map((d) => ({
      id: d.id,
      workspaceId: d.workspaceId,
      laneId: d.laneId,
      sessionId: d.sessionId ?? null,
      terminalId: d.terminalId ?? null,
      transport: d.transport,
      state: d.state,
      lastUpdated: d.lastUpdated,
    }));
}

// ── Audit ──────────────────────────────────────────────

export function writeAuditEntry(entry: {
  action: string;
  workspaceId: string;
  laneId?: string | null;
  sessionId?: string | null;
  detail: string;
}): void {
  db.collection("helios_audit").insert({
    timestamp: new Date().toISOString(),
    action: entry.action,
    workspaceId: entry.workspaceId,
    laneId: entry.laneId ?? undefined,
    sessionId: entry.sessionId ?? undefined,
    detail: entry.detail,
  });
}

export function getRecentAudit(limit = 50): {
  timestamp: string;
  action: string;
  workspaceId: string;
  laneId: string | null;
  sessionId: string | null;
  detail: string;
}[] {
  const { data } = db.collection("helios_audit").query();
  return data
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((d) => ({
      timestamp: d.timestamp,
      action: d.action,
      workspaceId: d.workspaceId,
      laneId: d.laneId ?? null,
      sessionId: d.sessionId ?? null,
      detail: d.detail,
    }));
}

// ── Session Snapshots ───────────────────────────

export type SessionSnapshot = BusLaneState;

export function saveSessionSnapshot(workspaceId: string, lanes: SessionSnapshot[]): void {
  try {
    const { data } = db.collection("helios_session_snapshots").query();
    const existing = data.find((d) => d.workspaceId === workspaceId);

    const snapshotData = {
      workspaceId,
      lanes: JSON.stringify(lanes),
      timestamp: new Date().toISOString(),
    };

    if (existing) {
      db.collection("helios_session_snapshots").update(existing.id, snapshotData);
    } else {
      db.collection("helios_session_snapshots").insert(snapshotData);
    }
  } catch {
    // Silently fail to avoid disrupting workflow
  }
}

export function loadSessionSnapshot(workspaceId: string): SessionSnapshot[] | null {
  try {
    const { data } = db.collection("helios_session_snapshots").query();
    const snapshot = data.find((d) => d.workspaceId === workspaceId);

    if (!snapshot || !snapshot.lanes) {
      return null;
    }

    return JSON.parse(snapshot.lanes) as SessionSnapshot[];
  } catch {
    return null;
  }
}

export function clearSessionSnapshot(workspaceId: string): void {
  try {
    const { data } = db.collection("helios_session_snapshots").query();
    const snapshot = data.find((d) => d.workspaceId === workspaceId);

    if (snapshot) {
      db.collection("helios_session_snapshots").remove(snapshot.id);
    }
  } catch {
    // Silently fail
  }
}
