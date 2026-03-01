/**
 * Helios Renderer
 *
 * Terminal-first renderer for the helios runtime.
 * Drives the lane → session → terminal lifecycle via RPC
 * and displays state transitions in real time.
 *
 * Features:
 * - Professional UI/UX with polished styling
 * - Keyboard shortcuts (Ctrl+1-5 for tab navigation)
 * - Toast notifications for user feedback
 * - Confirmation dialogs for destructive actions
 * - Loading states and status indicators
 * - Metrics dashboard
 * - Onboarding panel for new users
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

type Toast = {
  id: string;
  type: "success" | "error" | "warning";
  message: string;
  timeout?: NodeJS.Timeout;
};

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
type MetricSummary = {
  metric: string;
  unit: string;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  latest: number;
};
let metricsSummaries: MetricSummary[] = [];

// Renderer capabilities cache
type RendererCapabilities = {
  active_engine: string;
  available_engines: string[];
  hot_swap_supported: boolean;
};
let rendererCaps: RendererCapabilities | null = null;

// Chat messages
type ChatMessage = { role: "user" | "system"; text: string; ts: string };
let chatMessages: ChatMessage[] = [];

// Toasts
let toasts: Toast[] = [];

// Available lanes for reconnection
type AvailableLane = {
  laneId: string;
  state: string;
  transport: string;
  lastUpdated: string;
};
let availableLanes: AvailableLane[] = [];

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

// ── Toast Notifications ────────────────────────────────

function showToast(
  message: string,
  type: "success" | "error" | "warning" = "success",
  duration = 4000,
) {
  const id = `toast-${Date.now()}-${Math.random()}`;
  const toast: Toast = { id, type, message };

  if (duration > 0) {
    toast.timeout = setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  toasts.push(toast);
  render();
  return id;
}

function dismissToast(id: string) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const toast = toasts[idx];
    if (toast.timeout) clearTimeout(toast.timeout);
    toasts.splice(idx, 1);
    render();
  }
}

// ── Confirmation Dialog ────────────────────────────────

async function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal";

    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = title;

    const msgEl = document.createElement("div");
    msgEl.className = "modal-message";
    msgEl.textContent = message;

    const actionsEl = document.createElement("div");
    actionsEl.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn primary";
    confirmBtn.textContent = "Confirm";
    confirmBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(confirmBtn);

    modal.appendChild(titleEl);
    modal.appendChild(msgEl);
    modal.appendChild(actionsEl);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    confirmBtn.focus();
  });
}

// ── Lifecycle Actions ──────────────────────────────────

async function doCreateLane() {
  if (busy) return;
  busy = true;
  render();
  try {
    const workspaceId = ids.workspaceId ?? `ws_${Date.now()}`;
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "lane.create",
      payload: { preferred_transport: "cliproxy_harness" },
    })) as any;
    ids.workspaceId = workspaceId;
    ids.laneId = res?.result?.lane_id ?? null;
    addLog("lane.create", res?.status === "ok");
    if (res?.status === "ok") {
      showToast(`Lane created: ${ids.laneId?.slice(0, 12)}`, "success");
    } else {
      showToast("Failed to create lane", "error");
    }
  } catch (e: any) {
    addLog(`lane.create error: ${e?.message ?? e}`, false);
    showToast(`Error: ${e?.message ?? e}`, "error");
  }
  busy = false;
  render();
}

async function doAttachSession() {
  if (busy || !ids.laneId) return;
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "session.attach",
      payload: { id: `${ids.laneId}:session` },
    })) as any;
    ids.sessionId = res?.result?.session_id ?? null;
    addLog("session.attach", res?.status === "ok");
    if (res?.status === "ok") {
      showToast("Session attached successfully", "success");
    } else {
      showToast("Failed to attach session", "error");
    }
  } catch (e: any) {
    addLog(`session.attach error: ${e?.message ?? e}`, false);
    showToast(`Error: ${e?.message ?? e}`, "error");
  }
  busy = false;
  render();
}

async function doSpawnTerminal() {
  if (busy || !ids.sessionId || !ids.laneId) return;
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "terminal.spawn",
      payload: {
        id: `${ids.sessionId}:terminal`,
        lane_id: ids.laneId,
      },
    })) as any;
    ids.terminalId = res?.result?.terminal_id ?? null;
    if (xterm) xterm.clear();
    addLog("terminal.spawn", res?.status === "ok");
    if (res?.status === "ok") {
      showToast("Terminal spawned successfully", "success");
    } else {
      showToast("Failed to spawn terminal", "error");
    }
  } catch (e: any) {
    addLog(`terminal.spawn error: ${e?.message ?? e}`, false);
    showToast(`Error: ${e?.message ?? e}`, "error");
  }
  busy = false;
  render();
}

async function doFullLifecycle() {
  const confirmed = await confirm(
    "Start Full Lifecycle",
    "This will create a lane, attach a session, and spawn a terminal. Continue?",
  );
  if (!confirmed) return;

  busy = true;
  render();
  try {
    await doCreateLane();
    await doAttachSession();
    await doSpawnTerminal();
  } finally {
    busy = false;
    render();
  }
}

async function doRefreshState() {
  try {
    const state = (await electrobun.rpc?.request["heliosGetState"]()) as any;
    if (state) {
      applyState(state);
      addLog("state.refresh", true);
      showToast("State refreshed", "success", 2000);
    }
  } catch (e: any) {
    addLog(`state.refresh error: ${e?.message ?? e}`, false);
    showToast(`Refresh error: ${e?.message ?? e}`, "error");
  }
  await loadPersistedData();
  await loadMetrics();
  render();
}

async function doReconnectSession(laneId: string) {
  const confirmed = await confirm("Reconnect to Lane", `Reconnect to lane ${laneId.slice(0, 12)}?`);
  if (!confirmed) return;

  busy = true;
  render();
  try {
    ids.laneId = laneId;
    await doAttachSession();
    await doSpawnTerminal();
    showToast("Reconnected successfully", "success");
  } catch (e: any) {
    showToast(`Reconnection failed: ${e?.message ?? e}`, "error");
  }
  busy = false;
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
      electrobun.rpc?.request["heliosTerminalInput"]({ terminalId: ids.terminalId, data });
    }
  });

  // Forward resize
  xterm.onResize(({ cols, rows }) => {
    if (ids.terminalId) {
      electrobun.rpc?.request["heliosTerminalResize"]({ terminalId: ids.terminalId, cols, rows });
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

function _disposeXterm() {
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
    const lanes = (await electrobun.rpc?.request["heliosGetLanes"]()) as any;
    if (Array.isArray(lanes)) {
      persistedLanes = lanes;
      availableLanes = lanes.map((l: any) => ({
        laneId: l.laneId,
        state: l.state,
        transport: l.transport,
        lastUpdated: l.lastUpdated,
      }));
    }
  } catch {
    /* ignore */
  }
  try {
    const audit = (await electrobun.rpc?.request["heliosGetAudit"]()) as any;
    if (Array.isArray(audit)) auditEntries = audit.slice(0, 20);
  } catch {
    /* ignore */
  }
}

async function loadMetrics() {
  try {
    const report = (await electrobun.rpc?.request["heliosGetMetrics"]()) as any;
    if (report?.summaries) metricsSummaries = report.summaries;
  } catch {
    /* ignore */
  }
}

async function loadRendererCaps() {
  try {
    const res = (await electrobun.rpc?.request["heliosRendererCapabilities"]()) as any;
    if (res?.result) rendererCaps = res.result as RendererCapabilities;
  } catch {
    /* ignore */
  }
}

async function doRendererSwitch(engine: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRendererSwitch"]({
      targetEngine: engine,
    })) as any;
    addLog(`renderer.switch → ${engine}`, res?.status === "ok");
    await loadRendererCaps();
    if (res?.status === "ok") {
      showToast(`Switched to ${engine}`, "success", 2000);
    } else {
      showToast("Switch failed", "error");
    }
  } catch (e: any) {
    addLog(`renderer.switch error: ${e?.message ?? e}`, false);
    showToast(`Error: ${e?.message ?? e}`, "error");
  }
  busy = false;
  render();
}

async function doAgentRun(prompt: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "agent.run",
      payload: { prompt },
    })) as any;
    addLog("agent.run", res?.status === "ok");
    if (res?.error) {
      chatMessages.push({
        role: "system",
        text: `agent: ${res.error.message}`,
        ts: new Date().toISOString().slice(11, 19),
      });
      showToast("Agent error", "error", 3000);
    } else {
      showToast("Command sent to agent", "success", 2000);
    }
  } catch (e: any) {
    addLog(`agent.run error: ${e?.message ?? e}`, false);
    chatMessages.push({
      role: "system",
      text: `error: ${e?.message ?? e}`,
      ts: new Date().toISOString().slice(11, 19),
    });
    showToast(`Error: ${e?.message ?? e}`, "error");
  }
  busy = false;
  render();
}

function addChatMessage(text: string) {
  chatMessages.push({ role: "user", text, ts: new Date().toISOString().slice(11, 19) });
  if (chatMessages.length > 100) chatMessages.shift();
  doAgentRun(text);
}

// ── Keyboard Shortcuts ────────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "5") {
      const index = parseInt(e.key) - 1;
      if (index < TABS.length) {
        activeTab = TABS[index];
        render();
        e.preventDefault();
      }
    }
  });
}

// ── DOM helpers ────────────────────────────────────────

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(
  label: string,
  onClick: () => void,
  disabled = false,
  variant: "primary" | "secondary" | "danger" = "secondary",
): HTMLElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = `btn ${variant}`;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// ── Render helpers ────────────────────────────────────

function getLaneStatusDot(state: string): { class: string; text: string } {
  if (state === "active") return { class: "active", text: "●" };
  if (state === "error") return { class: "error", text: "●" };
  return { class: "idle", text: "●" };
}

function getRuntimeStatusDot(): { class: string; text: string } {
  const isActive =
    runtimeState.lane.state === "active" ||
    runtimeState.session.state === "active" ||
    runtimeState.terminal.state === "active";
  return isActive ? { class: "active", text: "●" } : { class: "idle", text: "●" };
}

// ── Render ─────────────────────────────────────────────

function render() {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";

  const layout = el("div", "layout");

  // Top bar
  const topbar = el("div", "topbar");
  const titleGroup = el("h1");
  const icon = el("span", "topbar-icon", "H");
  titleGroup.appendChild(icon);
  titleGroup.appendChild(el("span", undefined, "Helios"));
  topbar.appendChild(titleGroup);

  const statusGroup = el("div", "topbar-status");
  const runtimeStatus = getRuntimeStatusDot();
  const statusIndicator = el("span", `status-indicator ${runtimeStatus.class}`, runtimeStatus.text);
  statusGroup.appendChild(statusIndicator);
  statusGroup.appendChild(
    el(
      "span",
      "status-text",
      `${runtimeState.lane.state} | ${runtimeState.session.state} | ${runtimeState.terminal.state}`,
    ),
  );

  if (busy) {
    const busyIndicator = el("span", "busy-indicator");
    busyIndicator.appendChild(el("span", "busy-dot"));
    busyIndicator.appendChild(el("span", undefined, "working"));
    statusGroup.appendChild(busyIndicator);
  }

  topbar.appendChild(statusGroup);

  // Left rail
  const leftRail = el("div", "left-rail");
  leftRail.appendChild(el("div", "section-title", "Navigation"));

  const tabGroup = el("div", "tab-group");
  const tabList = el("ul", "tab-list");
  for (const t of TABS) {
    const li = el("li", t === activeTab ? "active" : "", t);
    li.addEventListener("click", () => {
      activeTab = t;
      render();
    });
    li.title = `${t} (Ctrl+${TABS.indexOf(t) + 1})`;
    tabList.appendChild(li);
  }
  tabGroup.appendChild(tabList);
  leftRail.appendChild(tabGroup);

  // Lifecycle controls
  leftRail.appendChild(el("div", "section-title mt", "Lifecycle"));
  leftRail.appendChild(btn("Create Lane", doCreateLane, busy, "primary"));
  leftRail.appendChild(btn("Attach Session", doAttachSession, busy || !ids.laneId));
  leftRail.appendChild(btn("Spawn Terminal", doSpawnTerminal, busy || !ids.sessionId));
  leftRail.appendChild(el("div", "separator"));
  leftRail.appendChild(btn("Full Lifecycle", doFullLifecycle, busy, "primary"));
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
    } else if (!ids.laneId) {
      // Onboarding panel for new users
      const onboarding = el("div", "onboarding-panel");
      onboarding.appendChild(el("div", "onboarding-icon", "🚀"));
      onboarding.appendChild(el("div", "onboarding-title", "Welcome to Helios"));
      onboarding.appendChild(
        el(
          "div",
          "onboarding-desc",
          "Helios is a terminal-first runtime manager that helps you create and manage computational lanes, sessions, and terminals.",
        ),
      );
      const ctaBtn = btn("Create Your First Lane", doCreateLane, busy, "primary");
      ctaBtn.className = "btn primary onboarding-btn";
      onboarding.appendChild(ctaBtn);
      center.appendChild(onboarding);
    } else {
      center.appendChild(
        el("div", "empty-state", "Run Spawn Terminal in the Lifecycle section to open a terminal"),
      );
    }
  } else if (activeTab === "session") {
    // Reconnect section with available lanes
    center.appendChild(el("div", "section-title", "Reconnect to Lane"));

    if (availableLanes.length === 0) {
      center.appendChild(el("div", "empty-state", "No lanes available — create one in Lifecycle"));
    } else {
      const table = el("div", "lane-table");
      for (const lane of availableLanes) {
        const row = el("div", "lane-row");

        const statusDot = getLaneStatusDot(lane.state);
        const statusEl = el("span", "lane-status");
        statusEl.appendChild(el("span", `lane-status-dot ${statusDot.class}`, statusDot.text));
        statusEl.appendChild(el("span", "lane-id", lane.laneId.slice(0, 12)));
        row.appendChild(statusEl);

        row.appendChild(el("span", "lane-transport", lane.transport));
        row.appendChild(el("span", "lane-updated", lane.lastUpdated.slice(11, 19)));

        const connectBtn = btn("Connect", () => doReconnectSession(lane.laneId), busy);
        connectBtn.style.width = "auto";
        connectBtn.style.marginBottom = "0";
        connectBtn.style.padding = "6px 12px";
        row.appendChild(connectBtn);

        table.appendChild(row);
      }
      center.appendChild(table);
    }

    // Show persisted lanes table
    center.appendChild(el("div", "section-title mt", "All Lanes"));
    if (persistedLanes.length === 0) {
      center.appendChild(el("div", "empty-state", "No persisted lanes yet"));
    } else {
      const table = el("div", "lane-table");
      for (const lane of persistedLanes) {
        const row = el("div", "lane-row");

        const statusDot = getLaneStatusDot(lane.state);
        const statusEl = el("span", "lane-status");
        statusEl.appendChild(el("span", `lane-status-dot ${statusDot.class}`, statusDot.text));
        statusEl.appendChild(el("span", "lane-id", lane.laneId.slice(0, 12)));
        row.appendChild(statusEl);

        row.appendChild(el("span", "lane-transport", lane.transport));
        row.appendChild(el("span", "lane-updated", lane.lastUpdated.slice(11, 19)));
        table.appendChild(row);
      }
      center.appendChild(table);
    }
  } else if (activeTab === "agent") {
    center.appendChild(el("div", "section-title", "Agent Delegation"));
    const statusCard = el("div", "card");
    statusCard.appendChild(el("div", "card-label", "A2A Boundary"));
    statusCard.appendChild(
      el("div", "card-value", "not configured — connect an A2A or ACP endpoint in settings"),
    );
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
    const chatContainer = el("div", "chat-container");

    chatContainer.appendChild(el("div", "section-title", "Agent Chat"));

    const chatLog = el("div", "chat-log");
    if (chatMessages.length === 0) {
      chatLog.appendChild(
        el("div", "empty-state", "Send a message to interact with the agent boundary"),
      );
    } else {
      for (const msg of chatMessages) {
        const row = el("div", `chat-msg chat-${msg.role}`);
        row.appendChild(el("span", "chat-ts", msg.ts));
        row.appendChild(el("span", "chat-text", msg.text));
        chatLog.appendChild(row);
      }
    }
    chatContainer.appendChild(chatLog);

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
    const sendBtn = btn(
      "Send",
      () => {
        if (input.value.trim()) {
          addChatMessage(input.value.trim());
          input.value = "";
        }
      },
      busy,
      "primary",
    );
    sendBtn.className = "btn primary chat-send-btn";
    inputRow.appendChild(sendBtn);
    chatContainer.appendChild(inputRow);

    center.appendChild(chatContainer);
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
        center.appendChild(
          btn(
            `${engine}${isActive ? " (active)" : ""}`,
            () => doRendererSwitch(engine),
            busy || isActive,
          ),
        );
      }
    } else {
      center.appendChild(
        el("div", "empty-state mt", "Run lifecycle to load renderer capabilities"),
      );
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

    // Metrics dashboard
    if (metricsSummaries.length > 0) {
      center.appendChild(el("div", "section-title mt", "Metrics Dashboard"));
      const metricsGrid = el("div", "metrics-grid");

      for (const m of metricsSummaries) {
        const card = el("div", "metric-card");
        card.appendChild(el("div", "metric-name", m.metric.replace(/_/g, " ")));
        card.appendChild(el("div", "metric-value", `${m.p50}${m.unit}`));

        const stats = el("div", "metric-stats");
        stats.appendChild(
          el("div", "metric-stat", `Min: <span class="metric-stat-value">${m.min}${m.unit}</span>`),
        );
        stats.appendChild(
          el("div", "metric-stat", `Max: <span class="metric-stat-value">${m.max}${m.unit}</span>`),
        );
        stats.appendChild(
          el("div", "metric-stat", `P95: <span class="metric-stat-value">${m.p95}${m.unit}</span>`),
        );
        stats.appendChild(
          el("div", "metric-stat", `Count: <span class="metric-stat-value">${m.count}x</span>`),
        );

        card.appendChild(stats);
        metricsGrid.appendChild(card);
      }

      center.appendChild(metricsGrid);
    }
  }

  // Right rail — event log + diagnostics
  const rightRail = el("div", "right-rail");
  rightRail.appendChild(el("div", "section-title", "Event Log"));
  const logContainer = el("div", "event-log");
  for (const entry of [...eventLog].reverse().slice(0, 20)) {
    const row = el("div", `log-entry ${entry.ok ? "" : "log-error"}`);
    const icon = el("span", "log-icon", entry.ok ? "✓" : "✕");
    row.appendChild(icon);
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

  rightRail.appendChild(el("div", "section-title mt", "Diagnostics"));
  const diagnostics = [
    ["Runtime", runtimeState.lane.state !== "idle" ? "active" : "idle"],
    ["Transport", "cliproxy_harness"],
    ["Lane", runtimeState.lane.state],
    ["Session", runtimeState.session.state],
    ["Terminal", runtimeState.terminal.state],
  ];

  for (const [label, value] of diagnostics) {
    const card = el("div", "card");
    card.appendChild(el("div", "card-label", label));
    const valueClass = value === "active" ? "status-ok" : value === "error" ? "status-error" : "";
    card.appendChild(el("div", `card-value ${valueClass}`, value));
    rightRail.appendChild(card);
  }

  // Status bar
  const statusbar = el("div", "statusbar");
  let statusText = "";
  if (ids.terminalId) {
    statusText = `terminal active (${ids.terminalId.slice(0, 16)})`;
  } else if (ids.sessionId) {
    statusText = "session attached";
  } else if (ids.laneId) {
    statusText = "lane created";
  } else {
    statusText = "ready";
  }

  const statusItem = el("div", "statusbar-item");
  statusItem.appendChild(el("span", "statusbar-icon"));
  statusItem.appendChild(el("span", undefined, `Helios — ${statusText}`));
  statusbar.appendChild(statusItem);

  layout.appendChild(topbar);
  layout.appendChild(leftRail);
  layout.appendChild(center);
  layout.appendChild(rightRail);
  layout.appendChild(statusbar);
  root.appendChild(layout);

  // Render toasts
  for (const toast of toasts) {
    const toastEl = document.createElement("div");
    toastEl.className = `toast ${toast.type}`;
    toastEl.appendChild(
      el("span", "toast-icon", toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "⚠"),
    );
    toastEl.appendChild(el("span", "toast-message", toast.message));
    document.body.appendChild(toastEl);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setupKeyboardShortcuts();
  render();
  await Promise.all([loadPersistedData(), loadMetrics(), loadRendererCaps()]);
  render();
});
