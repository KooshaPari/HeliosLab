/**
 * Helios Renderer
 *
 * Terminal-first renderer for the helios runtime.
 * Drives the lane → session → terminal lifecycle via RPC
 * and displays state transitions in real time.
 */

import { Electroview } from "electrobun/view";
import type { WorkspaceRPC } from "../ivde/rpc";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
// xterm.css loaded via <link> in index.html

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

// xterm.js instance (persists across re-renders)
let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let xtermMounted = false;

// Metrics cache
type MetricSummary = { metric: string; unit: string; count: number; min: number; max: number; p50: number; p95: number; latest: number };
let metricsSummaries: MetricSummary[] = [];

// Renderer capabilities cache
type RendererCapabilities = { active_engine: string; available_engines: string[]; hot_swap_supported: boolean };
let rendererCaps: RendererCapabilities | null = null;

// Chat messages
type ChatMessage = { role: "user" | "system"; text: string; ts: string };
let chatMessages: ChatMessage[] = [];

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
        if (xterm) {
          xterm.write(data.data);
        }
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
    if (xterm) xterm.clear();
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

// ── xterm.js Setup ────────────────────────────────────

function ensureXterm(): Terminal {
  if (xterm) return xterm;

  xterm = new Terminal({
    theme: {
      background: "#0a0a1a",
      foreground: "#c8c8e8",
      cursor: "#7b8cde",
      selectionBackground: "#3a3a6a",
      black: "#1a1a2e",
      red: "#e05555",
      green: "#5adb5a",
      yellow: "#e8a838",
      blue: "#7b8cde",
      magenta: "#b07acc",
      cyan: "#5ac8c8",
      white: "#e0e0e0",
    },
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);
  xterm.loadAddon(new WebLinksAddon());

  // Forward input to main process
  xterm.onData((data) => {
    if (ids.terminalId) {
      electrobun.rpc?.request.heliosTerminalInput({ terminalId: ids.terminalId, data });
    }
  });

  // Forward resize
  xterm.onResize(({ cols, rows }) => {
    if (ids.terminalId) {
      electrobun.rpc?.request.heliosTerminalResize({ terminalId: ids.terminalId, cols, rows });
    }
  });

  return xterm;
}

function mountXterm(container: HTMLElement) {
  const term = ensureXterm();
  if (!xtermMounted) {
    term.open(container);
    xtermMounted = true;
  }
  requestAnimationFrame(() => {
    fitAddon?.fit();
  });
}

function disposeXterm() {
  if (xterm) {
    xterm.dispose();
    xterm = null;
    fitAddon = null;
    xtermMounted = false;
  }
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

async function loadRendererCaps() {
  try {
    const res = await electrobun.rpc?.request.heliosRendererCapabilities();
    if (res?.result) rendererCaps = res.result as RendererCapabilities;
  } catch { /* ignore */ }
}

async function doRendererSwitch(engine: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = await electrobun.rpc?.request.heliosRendererSwitch({ targetEngine: engine });
    addLog(`renderer.switch → ${engine}`, res?.status === "ok");
    await loadRendererCaps();
  } catch (e: any) {
    addLog(`renderer.switch error: ${e?.message ?? e}`, false);
  }
  busy = false;
  render();
}

async function doAgentRun(prompt: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = await electrobun.rpc?.request.heliosRequest({
      method: "agent.run",
      payload: { prompt },
    });
    addLog("agent.run", res?.status === "ok");
    if (res?.error) {
      chatMessages.push({ role: "system", text: `agent: ${res.error.message}`, ts: new Date().toISOString().slice(11, 19) });
    }
  } catch (e: any) {
    addLog(`agent.run error: ${e?.message ?? e}`, false);
    chatMessages.push({ role: "system", text: `error: ${e?.message ?? e}`, ts: new Date().toISOString().slice(11, 19) });
  }
  busy = false;
  render();
}

function addChatMessage(text: string) {
  chatMessages.push({ role: "user", text, ts: new Date().toISOString().slice(11, 19) });
  if (chatMessages.length > 100) chatMessages.shift();
  doAgentRun(text);
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
      termContainer.id = "xterm-container";
      center.appendChild(termContainer);

      // Mount xterm after DOM insertion
      requestAnimationFrame(() => {
        const container = document.getElementById("xterm-container");
        if (container) mountXterm(container);
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
  } else if (activeTab === "agent") {
    center.appendChild(el("div", "section-title", "Agent Delegation"));
    const statusCard = el("div", "card");
    statusCard.appendChild(el("div", "card-label", "A2A Boundary"));
    statusCard.appendChild(el("div", "card-value", "not configured — connect an A2A or ACP endpoint in settings"));
    center.appendChild(statusCard);

    center.appendChild(el("div", "section-title mt", "Available Methods"));
    for (const m of ["agent.run", "agent.cancel"]) {
      const row = el("div", "card");
      row.appendChild(el("div", "card-label", m));
      row.appendChild(el("div", "card-value", "stub — returns A2A_NOT_CONFIGURED"));
      center.appendChild(row);
    }

    center.appendChild(el("div", "section-title mt", "Tool Interop Adapters"));
    for (const [name, methods] of [
      ["Upterm", "share.upterm.start / stop"],
      ["Tmate", "share.tmate.start / stop"],
      ["ZMX", "zmx.checkpoint / restore"],
    ] as const) {
      const row = el("div", "card");
      row.appendChild(el("div", "card-label", name));
      row.appendChild(el("div", "card-value", methods));
      center.appendChild(row);
    }
  } else if (activeTab === "chat") {
    center.appendChild(el("div", "section-title", "Agent Chat"));

    const chatLog = el("div", "chat-log");
    if (chatMessages.length === 0) {
      chatLog.appendChild(el("div", "empty-state", "Send a message to interact with the agent boundary"));
    } else {
      for (const msg of chatMessages) {
        const row = el("div", `chat-msg chat-${msg.role}`);
        row.appendChild(el("span", "log-ts", msg.ts));
        row.appendChild(el("span", "chat-text", msg.text));
        chatLog.appendChild(row);
      }
    }
    center.appendChild(chatLog);

    const inputRow = el("div", "chat-input-row");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-input";
    input.placeholder = "Send a command to agent boundary...";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        addChatMessage(input.value.trim());
        input.value = "";
      }
    });
    inputRow.appendChild(input);
    const sendBtn = btn("Send", () => {
      if (input.value.trim()) {
        addChatMessage(input.value.trim());
        input.value = "";
      }
    }, busy);
    sendBtn.className = "btn chat-send-btn";
    inputRow.appendChild(sendBtn);
    center.appendChild(inputRow);
  } else if (activeTab === "project") {
    center.appendChild(el("div", "section-title", "Workspace"));
    const wsCard = el("div", "card");
    wsCard.appendChild(el("div", "card-label", "Workspace ID"));
    wsCard.appendChild(el("div", "card-value", ids.workspaceId ?? "—"));
    center.appendChild(wsCard);

    if (rendererCaps) {
      center.appendChild(el("div", "section-title mt", "Renderer Engine"));
      const engineCard = el("div", "card");
      engineCard.appendChild(el("div", "card-label", "Active Engine"));
      engineCard.appendChild(el("div", "card-value", rendererCaps.active_engine));
      center.appendChild(engineCard);

      const availCard = el("div", "card");
      availCard.appendChild(el("div", "card-label", "Available"));
      availCard.appendChild(el("div", "card-value", rendererCaps.available_engines.join(", ")));
      center.appendChild(availCard);

      center.appendChild(el("div", "section-title mt", "Switch Engine"));
      for (const engine of rendererCaps.available_engines) {
        const isActive = engine === rendererCaps.active_engine;
        center.appendChild(btn(
          `${engine}${isActive ? " (active)" : ""}`,
          () => doRendererSwitch(engine),
          busy || isActive,
        ));
      }
    } else {
      center.appendChild(el("div", "empty-state mt", "Run lifecycle to load renderer capabilities"));
    }

    center.appendChild(el("div", "section-title mt", "Multiplexer Adapters"));
    for (const [name, desc] of [
      ["PAR", "git worktree lane management (par CLI)"],
      ["Zellij", "terminal session multiplexer (zellij CLI)"],
    ] as const) {
      const row = el("div", "card");
      row.appendChild(el("div", "card-label", name));
      row.appendChild(el("div", "card-value", desc));
      center.appendChild(row);
    }
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
  await Promise.all([loadPersistedData(), loadMetrics(), loadRendererCaps()]);
  render();
});
