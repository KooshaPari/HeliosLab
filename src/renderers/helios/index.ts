/**
 * Helios Renderer
 *
 * Terminal-first renderer for the helios runtime.
 * Drives the lane → session → terminal lifecycle via RPC
 * and displays state transitions in real time.
 */

import { Electroview } from "electrobun/view";
import type { WorkspaceRPC } from "../ivde/rpc";

// ── State ──────────────────────────────────────────────

type RuntimeState = {
  lane: { state: string };
  session: { state: string };
  terminal: { state: string };
};

type LifecycleIds = {
  workspaceId: string | null;
  laneId: string | null;
  sessionId: string | null;
  terminalId: string | null;
};

type EventLogEntry = {
  ts: string;
  label: string;
  ok: boolean;
};

type ActiveTab = "terminal" | "agent" | "session" | "chat" | "project";

let runtimeState: RuntimeState = {
  lane: { state: "idle" },
  session: { state: "idle" },
  terminal: { state: "idle" },
};
let ids: LifecycleIds = {
  workspaceId: null,
  laneId: null,
  sessionId: null,
  terminalId: null,
};
let eventLog: EventLogEntry[] = [];
let activeTab: ActiveTab = "terminal";
let busy = false;

const TABS: ActiveTab[] = ["terminal", "agent", "session", "chat", "project"];

// ── RPC Setup ──────────────────────────────────────────

const rpc = Electroview.defineRPC<WorkspaceRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {},
    messages: {
      "helios:state": (data: { state: any }) => {
        applyState(data.state);
        render();
      },
      "helios:event": (data: { event: any; state: any }) => {
        applyState(data.state);
        const topic = data.event?.topic ?? data.event?.payload?.runtime_event ?? "event";
        addLog(topic, true);
        render();
      },
    },
  },
});

const electrobun = new Electroview({ rpc });

function applyState(state: any) {
  if (!state) return;
  runtimeState = {
    lane: { state: state.lane?.state ?? state.lanes?.state ?? "idle" },
    session: { state: state.session?.state ?? state.sessions?.state ?? "idle" },
    terminal: { state: state.terminal?.state ?? state.terminals?.state ?? "idle" },
  };
}

function addLog(label: string, ok: boolean) {
  eventLog.push({ ts: new Date().toISOString().slice(11, 19), label, ok });
  if (eventLog.length > 50) eventLog.shift();
}

// ── Lifecycle Actions ──────────────────────────────────

async function doCreateLane() {
  if (busy) return;
  busy = true;
  render();
  try {
    const workspaceId = ids.workspaceId ?? `ws_${Date.now()}`;
    const res = await electrobun.rpc?.request.heliosRequest({
      method: "lane.create",
      payload: { preferred_transport: "cliproxy_harness" },
    });
    ids.workspaceId = workspaceId;
    ids.laneId = res?.result?.lane_id ?? null;
    addLog("lane.create", res?.status === "ok");
  } catch (e: any) {
    addLog(`lane.create error: ${e?.message ?? e}`, false);
  }
  busy = false;
  render();
}

async function doAttachSession() {
  if (busy || !ids.laneId) return;
  busy = true;
  render();
  try {
    const res = await electrobun.rpc?.request.heliosRequest({
      method: "session.attach",
      payload: { id: `${ids.laneId}:session` },
    });
    ids.sessionId = res?.result?.session_id ?? null;
    addLog("session.attach", res?.status === "ok");
  } catch (e: any) {
    addLog(`session.attach error: ${e?.message ?? e}`, false);
  }
  busy = false;
  render();
}

async function doSpawnTerminal() {
  if (busy || !ids.sessionId || !ids.laneId) return;
  busy = true;
  render();
  try {
    const res = await electrobun.rpc?.request.heliosRequest({
      method: "terminal.spawn",
      payload: {
        id: `${ids.sessionId}:terminal`,
        lane_id: ids.laneId,
      },
    });
    ids.terminalId = res?.result?.terminal_id ?? null;
    addLog("terminal.spawn", res?.status === "ok");
  } catch (e: any) {
    addLog(`terminal.spawn error: ${e?.message ?? e}`, false);
  }
  busy = false;
  render();
}

async function doFullLifecycle() {
  await doCreateLane();
  await doAttachSession();
  await doSpawnTerminal();
}

async function doRefreshState() {
  try {
    const state = await electrobun.rpc?.request.heliosGetState();
    if (state) {
      applyState(state);
      addLog("state.refresh", true);
    }
  } catch (e: any) {
    addLog(`state.refresh error: ${e?.message ?? e}`, false);
  }
  render();
}

// ── DOM helpers ────────────────────────────────────────

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(label: string, onClick: () => void, disabled = false): HTMLElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = "btn";
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// ── Render ─────────────────────────────────────────────

function render() {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";

  const layout = el("div", "layout");

  // Top bar
  const topbar = el("div", "topbar");
  topbar.appendChild(el("h1", undefined, "helios"));
  const statusText = [
    `lane: ${runtimeState.lane.state}`,
    `session: ${runtimeState.session.state}`,
    `terminal: ${runtimeState.terminal.state}`,
  ].join(" | ");
  topbar.appendChild(el("span", "status", statusText));
  if (busy) topbar.appendChild(el("span", "status busy-indicator", " working..."));

  // Left rail
  const leftRail = el("div", "left-rail");
  leftRail.appendChild(el("div", "section-title", "Surfaces"));
  const tabList = el("ul", "tab-list");
  for (const t of TABS) {
    const li = el("li", t === activeTab ? "active" : "", t);
    li.addEventListener("click", () => { activeTab = t; render(); });
    tabList.appendChild(li);
  }
  leftRail.appendChild(tabList);

  // Lifecycle controls
  leftRail.appendChild(el("div", "section-title mt", "Lifecycle"));
  leftRail.appendChild(btn("Create Lane", doCreateLane, busy));
  leftRail.appendChild(btn("Attach Session", doAttachSession, busy || !ids.laneId));
  leftRail.appendChild(btn("Spawn Terminal", doSpawnTerminal, busy || !ids.sessionId));
  leftRail.appendChild(el("div", "separator"));
  leftRail.appendChild(btn("Full Lifecycle", doFullLifecycle, busy));
  leftRail.appendChild(btn("Refresh State", doRefreshState, busy));

  // IDs
  leftRail.appendChild(el("div", "section-title mt", "Active IDs"));
  for (const [k, v] of Object.entries(ids)) {
    const card = el("div", "card");
    card.appendChild(el("div", "card-label", k));
    card.appendChild(el("div", "card-value", v ? String(v).slice(0, 20) : "—"));
    leftRail.appendChild(card);
  }

  // Center — surface content
  const center = el("div", "center");
  if (activeTab === "terminal" && ids.terminalId) {
    center.appendChild(el("div", "surface-ready", `Terminal ${ids.terminalId} ready — native embed in Phase 3`));
  } else if (activeTab === "session" && ids.sessionId) {
    center.appendChild(el("div", "surface-ready", `Session ${ids.sessionId} active`));
  } else {
    center.appendChild(el("div", "empty-state", `${activeTab} surface — ${ids.laneId ? "lifecycle active" : "run Create Lane to start"}`));
  }

  // Right rail — event log + diagnostics
  const rightRail = el("div", "right-rail");
  rightRail.appendChild(el("div", "section-title", "Event Log"));
  const logContainer = el("div", "event-log");
  for (const entry of [...eventLog].reverse().slice(0, 20)) {
    const row = el("div", `log-entry ${entry.ok ? "" : "log-error"}`);
    row.appendChild(el("span", "log-ts", entry.ts));
    row.appendChild(el("span", "log-label", entry.label));
    logContainer.appendChild(row);
  }
  if (eventLog.length === 0) {
    logContainer.appendChild(el("div", "log-empty", "No events yet"));
  }
  rightRail.appendChild(logContainer);

  rightRail.appendChild(el("div", "section-title mt", "Diagnostics"));
  for (const [label, value] of [
    ["Runtime", runtimeState.lane.state !== "idle" ? "active" : "idle"],
    ["Transport", "cliproxy_harness"],
    ["Lane", runtimeState.lane.state],
    ["Session", runtimeState.session.state],
    ["Terminal", runtimeState.terminal.state],
  ]) {
    const card = el("div", "card");
    card.appendChild(el("div", "card-label", label));
    card.appendChild(el("div", "card-value", value));
    rightRail.appendChild(card);
  }

  // Status bar
  const statusbar = el("div", "statusbar");
  statusbar.textContent = ids.terminalId
    ? `helios runtime — terminal spawned (${ids.terminalId.slice(0, 16)})`
    : ids.sessionId
      ? `helios runtime — session attached`
      : ids.laneId
        ? `helios runtime — lane created`
        : `helios runtime — ready`;

  layout.appendChild(topbar);
  layout.appendChild(leftRail);
  layout.appendChild(center);
  layout.appendChild(rightRail);
  layout.appendChild(statusbar);
  root.appendChild(layout);
}

document.addEventListener("DOMContentLoaded", render);
