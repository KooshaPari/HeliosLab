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

// Terminal output buffer
let terminalOutput = "";
const MAX_TERMINAL_CHARS = 100_000;

// Metrics cache
type MetricSummary = { metric: string; unit: string; count: number; min: number; max: number; p50: number; p95: number; latest: number };
let metricsSummaries: MetricSummary[] = [];

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
      "helios:terminal-data": (data: { terminalId: string; data: string }) => {
        terminalOutput += data.data;
        // Cap buffer size
        if (terminalOutput.length > MAX_TERMINAL_CHARS) {
          terminalOutput = terminalOutput.slice(-MAX_TERMINAL_CHARS);
        }
        renderTerminalOutput();
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
    terminalOutput = "";
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
  await loadPersistedData();
  await loadMetrics();
  render();
}

// ── Terminal Input ─────────────────────────────────────

function setupTerminalInput(container: HTMLElement) {
  container.tabIndex = 0;
  container.addEventListener("keydown", (e) => {
    if (!ids.terminalId) return;

    let data = "";
    if (e.key === "Enter") data = "\r";
    else if (e.key === "Backspace") data = "\x7f";
    else if (e.key === "Tab") { data = "\t"; e.preventDefault(); }
    else if (e.key === "Escape") data = "\x1b";
    else if (e.key === "ArrowUp") data = "\x1b[A";
    else if (e.key === "ArrowDown") data = "\x1b[B";
    else if (e.key === "ArrowRight") data = "\x1b[C";
    else if (e.key === "ArrowLeft") data = "\x1b[D";
    else if (e.ctrlKey && e.key === "c") data = "\x03";
    else if (e.ctrlKey && e.key === "d") data = "\x04";
    else if (e.ctrlKey && e.key === "l") data = "\x0c";
    else if (e.ctrlKey && e.key === "u") data = "\x15";
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) data = e.key;
    else return;

    e.preventDefault();
    electrobun.rpc?.request.heliosTerminalInput({ terminalId: ids.terminalId, data });
  });

  // Handle paste
  container.addEventListener("paste", (e) => {
    if (!ids.terminalId) return;
    const text = e.clipboardData?.getData("text");
    if (text) {
      electrobun.rpc?.request.heliosTerminalInput({ terminalId: ids.terminalId, data: text });
    }
  });
}

// ── Persisted Data ─────────────────────────────────────

type PersistedLane = {
  laneId: string;
  state: string;
  transport: string;
  sessionId: string | null;
  terminalId: string | null;
  lastUpdated: string;
};

type AuditEntry = {
  timestamp: string;
  action: string;
  detail: string;
};

let persistedLanes: PersistedLane[] = [];
let auditEntries: AuditEntry[] = [];

async function loadPersistedData() {
  try {
    const lanes = await electrobun.rpc?.request.heliosGetLanes();
    if (Array.isArray(lanes)) persistedLanes = lanes;
  } catch { /* ignore */ }
  try {
    const audit = await electrobun.rpc?.request.heliosGetAudit();
    if (Array.isArray(audit)) auditEntries = audit.slice(0, 20);
  } catch { /* ignore */ }
}

async function loadMetrics() {
  try {
    const report = await electrobun.rpc?.request.heliosGetMetrics();
    if (report?.summaries) metricsSummaries = report.summaries;
  } catch { /* ignore */ }
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

// ── Render helpers ────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function renderTerminalOutput() {
  const termEl = document.getElementById("terminal-output");
  if (!termEl) return;
  termEl.textContent = stripAnsi(terminalOutput);
  termEl.scrollTop = termEl.scrollHeight;
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

  if (activeTab === "terminal") {
    if (ids.terminalId) {
      const termContainer = el("div", "terminal-container");
      const termOutput = el("pre", "terminal-output");
      termOutput.id = "terminal-output";
      termOutput.textContent = stripAnsi(terminalOutput);
      termContainer.appendChild(termOutput);
      setupTerminalInput(termContainer);
      center.appendChild(termContainer);

      // Auto-focus and set up resize
      requestAnimationFrame(() => {
        termContainer.focus();
        // Send initial resize based on container dimensions
        const charWidth = 7.8; // approximate monospace char width at 13px
        const lineHeight = 18.2; // approximate line height at 13px * 1.4
        const cols = Math.floor(termOutput.clientWidth / charWidth);
        const rows = Math.floor(termOutput.clientHeight / lineHeight);
        if (ids.terminalId && cols > 0 && rows > 0) {
          electrobun.rpc?.request.heliosTerminalResize({ terminalId: ids.terminalId, cols, rows });
        }
      });
    } else {
      center.appendChild(el("div", "empty-state", ids.laneId ? "Run Spawn Terminal to open a pty" : "Run Full Lifecycle to start"));
    }
  } else if (activeTab === "session") {
    // Show persisted lanes table
    center.appendChild(el("div", "section-title", "Persisted Lanes"));
    if (persistedLanes.length === 0) {
      center.appendChild(el("div", "empty-state", "No persisted lanes — run lifecycle to create one"));
    } else {
      const table = el("div", "lane-table");
      for (const lane of persistedLanes) {
        const row = el("div", "lane-row");
        row.appendChild(el("span", "lane-id", lane.laneId.slice(0, 12)));
        row.appendChild(el("span", "lane-transport", lane.transport));
        row.appendChild(el("span", "lane-session", lane.sessionId ? lane.sessionId.slice(0, 12) : "—"));
        row.appendChild(el("span", "lane-updated", lane.lastUpdated.slice(11, 19)));
        table.appendChild(row);
      }
      center.appendChild(table);
    }
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

  // Audit trail
  if (auditEntries.length > 0) {
    rightRail.appendChild(el("div", "section-title mt", "Audit Trail"));
    const auditContainer = el("div", "event-log");
    for (const entry of auditEntries.slice(0, 10)) {
      const row = el("div", "log-entry");
      row.appendChild(el("span", "log-ts", entry.timestamp.slice(11, 19)));
      row.appendChild(el("span", "log-label", `${entry.action}: ${entry.detail.slice(0, 40)}`));
      auditContainer.appendChild(row);
    }
    rightRail.appendChild(auditContainer);
  }

  // Metrics
  if (metricsSummaries.length > 0) {
    rightRail.appendChild(el("div", "section-title mt", "Metrics"));
    for (const m of metricsSummaries) {
      const card = el("div", "card");
      card.appendChild(el("div", "card-label", m.metric.replace(/_/g, " ")));
      card.appendChild(el("div", "card-value", `p50: ${m.p50}${m.unit} | p95: ${m.p95}${m.unit} (${m.count}x)`));
      rightRail.appendChild(card);
    }
  }

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
    ? `helios runtime — terminal active (${ids.terminalId.slice(0, 16)})`
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

document.addEventListener("DOMContentLoaded", async () => {
  render();
  await loadPersistedData();
  await loadMetrics();
  render();
});
