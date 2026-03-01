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
// Xterm.css loaded via <link> in index.html

// ── State ──────────────────────────────────────────────

interface RuntimeState {
  lane: { state: string };
  session: { state: string };
  terminal: { state: string };
}

interface LifecycleIds {
  workspaceId: string | null;
  laneId: string | null;
  sessionId: string | null;
  terminalId: string | null;
}

interface EventLogEntry {
  ts: string;
  label: string;
  ok: boolean;
}

type ActiveTab = "terminal" | "agent" | "session" | "chat" | "project";

interface Toast {
  id: string;
  type: "success" | "error" | "warning";
  message: string;
  timeout?: NodeJS.Timeout;
}

type RpcResponse = Record<string, unknown>;

let runtimeState: RuntimeState = {
  lane: { state: "idle" },
  session: { state: "idle" },
  terminal: { state: "idle" },
};
const ids: LifecycleIds = {
  workspaceId: null,
  laneId: null,
  sessionId: null,
  terminalId: null,
};
const eventLog: EventLogEntry[] = [];
let activeTab: ActiveTab = "terminal";
let busy = false;

// Xterm.js instance (persists across re-renders)
let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let xtermMounted = false;

// Metrics cache
interface MetricSummary {
  metric: string;
  unit: string;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  latest: number;
}
let metricsSummaries: MetricSummary[] = [];

// Renderer capabilities cache
interface RendererCapabilities {
  active_engine: string;
  available_engines: string[];
  hot_swap_supported: boolean;
}
let rendererCaps: RendererCapabilities | null = null;

// Chat messages
interface ChatMessage { role: "user" | "system"; text: string; ts: string }
const chatMessages: ChatMessage[] = [];

// Toasts
const toasts: Toast[] = [];

// Available lanes for reconnection
interface AvailableLane {
  laneId: string;
  state: string;
  transport: string;
  lastUpdated: string;
}
let availableLanes: AvailableLane[] = [];

const TABS: ActiveTab[] = ["terminal", "agent", "session", "chat", "project"];

// ── RPC Setup ──────────────────────────────────────────

const rpc = Electroview.defineRPC<WorkspaceRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {},
    messages: {
      "helios:state": (data: { state: Record<string, unknown> }) => {
        applyState(data.state);
        render();
      },
      "helios:event": (data: { event: Record<string, unknown>; state: Record<string, unknown> }) => {
        applyState(data.state);
        const topic = (data.event?.topic as string) ?? (data.event?.payload as Record<string, unknown>)?.runtime_event ?? "event";
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

/**
 * Apply state update to runtime state
 * @param state - The state object to apply
 */
function applyState(state: Record<string, unknown>) {
  if (!state) {return;}
  const laneState = state.lane as Record<string, string> | undefined;
  const lanesState = state.lanes as Record<string, string> | undefined;
  const sessionState = state.session as Record<string, string> | undefined;
  const sessionsState = state.sessions as Record<string, string> | undefined;
  const terminalState = state.terminal as Record<string, string> | undefined;
  const terminalsState = state.terminals as Record<string, string> | undefined;
  runtimeState = {
    lane: { state: laneState?.state ?? lanesState?.state ?? "idle" },
    session: { state: sessionState?.state ?? sessionsState?.state ?? "idle" },
    terminal: { state: terminalState?.state ?? terminalsState?.state ?? "idle" },
  };
}

/**
 * Add entry to event log
 * @param label - Event label
 * @param ok - Whether event succeeded
 */
function addLog(label: string, ok: boolean) {
  eventLog.push({ ts: new Date().toISOString().slice(11, 19), label, ok });
  if (eventLog.length > 50) {eventLog.shift();}
}

// ── Toast Notifications ────────────────────────────────

/**
 * Show a toast notification
 * @param message - Message text
 * @param type - Toast type
 * @param duration - Duration in milliseconds
 * @returns Toast ID
 */
function showToast(
  message: string,
  type: "success" | "error" | "warning" = "success",
  duration = 4000,
): string {
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

/**
 * Dismiss a toast notification
 * @param id - Toast ID
 */
function dismissToast(id: string) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const toast = toasts[idx];
    if (toast.timeout) {clearTimeout(toast.timeout);}
    toasts.splice(idx, 1);
    render();
  }
}

// ── Confirmation Dialog ────────────────────────────────

/**
 * Show a confirmation dialog
 * @param title - Dialog title
 * @param message - Dialog message
 * @returns Promise that resolves to true if confirmed, false otherwise
 */
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

    actionsEl.append(cancelBtn);
    actionsEl.append(confirmBtn);

    modal.append(titleEl);
    modal.append(msgEl);
    modal.append(actionsEl);

    overlay.append(modal);
    document.body.append(overlay);

    confirmBtn.focus();
  });
}

// ── Lifecycle Actions ──────────────────────────────────

async function doCreateLane(): Promise<void> {
  if (busy) {return;}
  busy = true;
  render();
  try {
    const workspaceId = ids.workspaceId ?? `ws_${Date.now()}`;
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "lane.create",
      payload: { preferred_transport: "cliproxy_harness" },
    })) as RpcResponse;
    ids.workspaceId = workspaceId;
    ids.laneId = (res?.result as Record<string, unknown>)?.lane_id as string ?? null;
    addLog("lane.create", res?.status === "ok");
    if (res?.status === "ok") {
      showToast(`Lane created: ${ids.laneId?.slice(0, 12)}`, "success");
    } else {
      showToast("Failed to create lane", "error");
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`lane.create error: ${err?.message ?? error}`, false);
    showToast(`Error: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

async function doAttachSession(): Promise<void> {
  if (busy || !ids.laneId) {return;}
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "session.attach",
      payload: { id: `${ids.laneId}:session` },
    })) as RpcResponse;
    ids.sessionId = (res?.result as Record<string, unknown>)?.session_id as string ?? null;
    addLog("session.attach", res?.status === "ok");
    if (res?.status === "ok") {
      showToast("Session attached successfully", "success");
    } else {
      showToast("Failed to attach session", "error");
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`session.attach error: ${err?.message ?? error}`, false);
    showToast(`Error: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

async function doSpawnTerminal(): Promise<void> {
  if (busy || !ids.sessionId || !ids.laneId) {return;}
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "terminal.spawn",
      payload: {
        id: `${ids.sessionId}:terminal`,
        lane_id: ids.laneId,
      },
    })) as RpcResponse;
    ids.terminalId = (res?.result as Record<string, unknown>)?.terminal_id as string ?? null;
    if (xterm) {xterm.clear();}
    addLog("terminal.spawn", res?.status === "ok");
    if (res?.status === "ok") {
      showToast("Terminal spawned successfully", "success");
    } else {
      showToast("Failed to spawn terminal", "error");
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`terminal.spawn error: ${err?.message ?? error}`, false);
    showToast(`Error: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

/**
 * Run full lifecycle: create lane, attach session, spawn terminal
 * @returns Promise that resolves when complete
 */
async function doFullLifecycle(): Promise<void> {
  const confirmed = await confirm(
    "Start Full Lifecycle",
    "This will create a lane, attach a session, and spawn a terminal. Continue?",
  );
  if (!confirmed) {return;}

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

/**
 * Refresh runtime state from server
 * @returns Promise that resolves when complete
 */
async function doRefreshState(): Promise<void> {
  try {
    const state = (await electrobun.rpc?.request["heliosGetState"]()) as RpcResponse;
    if (state) {
      applyState(state);
      addLog("state.refresh", true);
      showToast("State refreshed", "success", 2000);
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`state.refresh error: ${err?.message ?? error}`, false);
    showToast(`Refresh error: ${err?.message ?? error}`, "error");
  }
  await loadPersistedData();
  await loadMetrics();
  render();
}

/**
 * Reconnect to an existing lane
 * @param laneId - ID of the lane to reconnect to
 * @returns Promise that resolves when complete
 */
async function doReconnectSession(laneId: string): Promise<void> {
  const confirmed = await confirm("Reconnect to Lane", `Reconnect to lane ${laneId.slice(0, 12)}?`);
  if (!confirmed) {return;}

  busy = true;
  render();
  try {
    ids.laneId = laneId;
    await doAttachSession();
    await doSpawnTerminal();
    showToast("Reconnected successfully", "success");
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    showToast(`Reconnection failed: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

// ── xterm.js Setup ────────────────────────────────────

/**
 * Ensure xterm instance is initialized
 * @returns Terminal instance
 */
function ensureXterm(): Terminal {
  if (xterm) {return xterm;}

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
  xterm.onData((data: string) => {
    if (ids.terminalId) {
      electrobun.rpc?.request["heliosTerminalInput"]({ terminalId: ids.terminalId, data });
    }
  });

  // Forward resize
  xterm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    if (ids.terminalId) {
      electrobun.rpc?.request["heliosTerminalResize"]({ terminalId: ids.terminalId, cols, rows });
    }
  });

  return xterm;
}

/**
 * Mount xterm instance to DOM
 * @param container - Container element
 */
function mountXterm(container: HTMLElement): void {
  const term = ensureXterm();
  if (!xtermMounted) {
    term.open(container);
    xtermMounted = true;
  }
  requestAnimationFrame(() => {
    fitAddon?.fit();
  });
}

/**
 * Dispose xterm instance
 */
function _disposeXterm(): void {
  if (xterm) {
    xterm.dispose();
    xterm = null;
    fitAddon = null;
    xtermMounted = false;
  }
}

// ── Persisted Data ─────────────────────────────────────

interface PersistedLane {
  laneId: string;
  state: string;
  transport: string;
  sessionId: string | null;
  terminalId: string | null;
  lastUpdated: string;
}

interface AuditEntry {
  timestamp: string;
  action: string;
  detail: string;
}

let persistedLanes: PersistedLane[] = [];
let auditEntries: AuditEntry[] = [];

/**
 * Load persisted lanes and audit data from server
 * @returns Promise that resolves when complete
 */
async function loadPersistedData(): Promise<void> {
  try {
    const lanes = (await electrobun.rpc?.request["heliosGetLanes"]()) as PersistedLane[] | unknown;
    if (Array.isArray(lanes)) {
      persistedLanes = lanes as PersistedLane[];
      availableLanes = lanes.map((l: PersistedLane) => ({
        laneId: l.laneId,
        state: l.state,
        transport: l.transport,
        lastUpdated: l.lastUpdated,
      }));
    }
  } catch {
    /* Ignore */
  }
  try {
    const audit = (await electrobun.rpc?.request["heliosGetAudit"]()) as AuditEntry[] | unknown;
    if (Array.isArray(audit)) {auditEntries = (audit as AuditEntry[]).slice(0, 20);}
  } catch {
    /* Ignore */
  }
}

/**
 * Load metrics from server
 * @returns Promise that resolves when complete
 */
async function loadMetrics(): Promise<void> {
  try {
    const report = (await electrobun.rpc?.request["heliosGetMetrics"]()) as RpcResponse;
    if (report?.summaries) {metricsSummaries = report.summaries as MetricSummary[];}
  } catch {
    /* Ignore */
  }
}

/**
 * Load renderer capabilities from server
 * @returns Promise that resolves when complete
 */
async function loadRendererCaps(): Promise<void> {
  try {
    const res = (await electrobun.rpc?.request["heliosRendererCapabilities"]()) as RpcResponse;
    if (res?.result) {rendererCaps = res.result as RendererCapabilities;}
  } catch {
    /* Ignore */
  }
}

/**
 * Switch to a different renderer engine
 * @param engine - Engine name to switch to
 * @returns Promise that resolves when complete
 */
async function doRendererSwitch(engine: string): Promise<void> {
  if (busy) {return;}
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRendererSwitch"]({
      targetEngine: engine,
    })) as RpcResponse;
    addLog(`renderer.switch → ${engine}`, res?.status === "ok");
    await loadRendererCaps();
    if (res?.status === "ok") {
      showToast(`Switched to ${engine}`, "success", 2000);
    } else {
      showToast("Switch failed", "error");
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`renderer.switch error: ${err?.message ?? error}`, false);
    showToast(`Error: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

/**
 * Run agent with prompt
 * @param prompt - Prompt to send to agent
 * @returns Promise that resolves when complete
 */
async function doAgentRun(prompt: string): Promise<void> {
  if (busy) {return;}
  busy = true;
  render();
  try {
    const res = (await electrobun.rpc?.request["heliosRequest"]({
      method: "agent.run",
      payload: { prompt },
    })) as RpcResponse;
    addLog("agent.run", res?.status === "ok");
    if (res?.error) {
      const errorMsg = (res.error as Record<string, unknown>).message as string;
      chatMessages.push({
        role: "system",
        text: `agent: ${errorMsg}`,
        ts: new Date().toISOString().slice(11, 19),
      });
      showToast("Agent error", "error", 3000);
    } else {
      showToast("Command sent to agent", "success", 2000);
    }
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    addLog(`agent.run error: ${err?.message ?? error}`, false);
    chatMessages.push({
      role: "system",
      text: `error: ${err?.message ?? error}`,
      ts: new Date().toISOString().slice(11, 19),
    });
    showToast(`Error: ${err?.message ?? error}`, "error");
  }
  busy = false;
  render();
}

/**
 * Add message to chat and run agent
 * @param text - Message text
 */
function addChatMessage(text: string): void {
  chatMessages.push({ role: "user", text, ts: new Date().toISOString().slice(11, 19) });
  if (chatMessages.length > 100) {chatMessages.shift();}
  void doAgentRun(text);
}

// ── Keyboard Shortcuts ────────────────────────────────

/**
 * Setup keyboard shortcuts for tab navigation
 */
function setupKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e: KeyboardEvent) => {
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

/**
 * Create DOM element with optional class and text
 * @param tag - Element tag name
 * @param cls - Optional CSS class name
 * @param text - Optional text content
 * @returns Created element
 */
function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) {e.className = cls;}
  if (text) {e.textContent = text;}
  return e;
}

/**
 * Create button element
 * @param label - Button label
 * @param onClick - Click handler
 * @param disabled - Whether button is disabled
 * @param variant - Button style variant
 * @returns Created button element
 */
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

/**
 * Get status dot styling and text
 * @param state - Lane state
 * @returns Object with class and text
 */
function getLaneStatusDot(state: string): { class: string; text: string } {
  if (state === "active") {return { class: "active", text: "●" };}
  if (state === "error") {return { class: "error", text: "●" };}
  return { class: "idle", text: "●" };
}

/**
 * Get overall runtime status dot
 * @returns Object with class and text
 */
function getRuntimeStatusDot(): { class: string; text: string } {
  const isActive =
    runtimeState.lane.state === "active" ||
    runtimeState.session.state === "active" ||
    runtimeState.terminal.state === "active";
  return isActive ? { class: "active", text: "●" } : { class: "idle", text: "●" };
}

// ── Render ─────────────────────────────────────────────

/**
 * Render the entire UI
 */
function render(): void {
  const root = document.querySelector("#root") as HTMLElement | null;
  if (!root) {return;}
  root.textContent = "";

  const layout = el("div", "layout");

  // Top bar
  const topbar = el("div", "topbar");
  const titleGroup = el("h1");
  const icon = el("span", "topbar-icon", "H");
  titleGroup.append(icon);
  titleGroup.append(el("span", undefined, "Helios"));
  topbar.append(titleGroup);

  const statusGroup = el("div", "topbar-status");
  const runtimeStatus = getRuntimeStatusDot();
  const statusIndicator = el("span", `status-indicator ${runtimeStatus.class}`, runtimeStatus.text);
  statusGroup.append(statusIndicator);
  statusGroup.append(
    el(
      "span",
      "status-text",
      `${runtimeState.lane.state} | ${runtimeState.session.state} | ${runtimeState.terminal.state}`,
    ),
  );

  if (busy) {
    const busyIndicator = el("span", "busy-indicator");
    busyIndicator.append(el("span", "busy-dot"));
    busyIndicator.append(el("span", undefined, "working"));
    statusGroup.append(busyIndicator);
  }

  topbar.append(statusGroup);

  // Left rail
  const leftRail = el("div", "left-rail");
  leftRail.append(el("div", "section-title", "Navigation"));

  const tabGroup = el("div", "tab-group");
  const tabList = el("ul", "tab-list");
  const createTabClickHandler = (tab: ActiveTab): (() => void) => {
    return () => {
      activeTab = tab;
      render();
    };
  };
  for (const t of TABS) {
    const li = el("li", t === activeTab ? "active" : "", t);
    li.addEventListener("click", createTabClickHandler(t));
    li.title = `${t} (Ctrl+${TABS.indexOf(t) + 1})`;
    tabList.append(li);
  }
  tabGroup.append(tabList);
  leftRail.append(tabGroup);

  // Lifecycle controls
  leftRail.append(el("div", "section-title mt", "Lifecycle"));
  leftRail.append(btn("Create Lane", doCreateLane, busy, "primary"));
  leftRail.append(btn("Attach Session", doAttachSession, busy || !ids.laneId));
  leftRail.append(btn("Spawn Terminal", doSpawnTerminal, busy || !ids.sessionId));
  leftRail.append(el("div", "separator"));
  leftRail.append(btn("Full Lifecycle", doFullLifecycle, busy, "primary"));
  leftRail.append(btn("Refresh State", doRefreshState, busy));

  // IDs
  leftRail.append(el("div", "section-title mt", "Active IDs"));
  for (const [k, v] of Object.entries(ids)) {
    const card = el("div", "card");
    card.append(el("div", "card-label", k));
    card.append(el("div", "card-value", v ? String(v).slice(0, 20) : "—"));
    leftRail.append(card);
  }

  // Center — surface content
  const center = el("div", "center");

  if (activeTab === "terminal") {
    if (ids.terminalId) {
      const termContainer = el("div", "terminal-container");
      termContainer.id = "xterm-container";
      center.append(termContainer);

      // Mount xterm after DOM insertion
      requestAnimationFrame(() => {
        const container = document.querySelector("#xterm-container") as HTMLElement | null;
        if (container) {mountXterm(container);}
      });
    } else if (!ids.laneId) {
      // Onboarding panel for new users
      const onboarding = el("div", "onboarding-panel");
      onboarding.append(el("div", "onboarding-icon", "🚀"));
      onboarding.append(el("div", "onboarding-title", "Welcome to Helios"));
      onboarding.append(
        el(
          "div",
          "onboarding-desc",
          "Helios is a terminal-first runtime manager that helps you create and manage computational lanes, sessions, and terminals.",
        ),
      );
      const ctaBtn = btn("Create Your First Lane", doCreateLane, busy, "primary");
      ctaBtn.className = "btn primary onboarding-btn";
      onboarding.append(ctaBtn);
      center.append(onboarding);
    } else {
      center.append(
        el("div", "empty-state", "Run Spawn Terminal in the Lifecycle section to open a terminal"),
      );
    }
  } else if (activeTab === "session") {
    // Reconnect section with available lanes
    center.append(el("div", "section-title", "Reconnect to Lane"));

    if (availableLanes.length === 0) {
      center.append(el("div", "empty-state", "No lanes available — create one in Lifecycle"));
    } else {
      const table = el("div", "lane-table");
      for (const lane of availableLanes) {
        const row = el("div", "lane-row");

        const statusDot = getLaneStatusDot(lane.state);
        const statusEl = el("span", "lane-status");
        statusEl.append(el("span", `lane-status-dot ${statusDot.class}`, statusDot.text));
        statusEl.append(el("span", "lane-id", lane.laneId.slice(0, 12)));
        row.append(statusEl);

        row.append(el("span", "lane-transport", lane.transport));
        row.append(el("span", "lane-updated", lane.lastUpdated.slice(11, 19)));

        const connectBtn = btn("Connect", () => doReconnectSession(lane.laneId), busy);
        connectBtn.style.width = "auto";
        connectBtn.style.marginBottom = "0";
        connectBtn.style.padding = "6px 12px";
        row.append(connectBtn);

        table.append(row);
      }
      center.append(table);
    }

    // Show persisted lanes table
    center.append(el("div", "section-title mt", "All Lanes"));
    if (persistedLanes.length === 0) {
      center.append(el("div", "empty-state", "No persisted lanes yet"));
    } else {
      const table = el("div", "lane-table");
      for (const lane of persistedLanes) {
        const row = el("div", "lane-row");

        const statusDot = getLaneStatusDot(lane.state);
        const statusEl = el("span", "lane-status");
        statusEl.append(el("span", `lane-status-dot ${statusDot.class}`, statusDot.text));
        statusEl.append(el("span", "lane-id", lane.laneId.slice(0, 12)));
        row.append(statusEl);

        row.append(el("span", "lane-transport", lane.transport));
        row.append(el("span", "lane-updated", lane.lastUpdated.slice(11, 19)));
        table.append(row);
      }
      center.append(table);
    }
  } else if (activeTab === "agent") {
    center.append(el("div", "section-title", "Agent Delegation"));
    const statusCard = el("div", "card");
    statusCard.append(el("div", "card-label", "A2A Boundary"));
    statusCard.append(
      el("div", "card-value", "not configured — connect an A2A or ACP endpoint in settings"),
    );
    center.append(statusCard);

    center.append(el("div", "section-title mt", "Available Methods"));
    for (const m of ["agent.run", "agent.cancel"]) {
      const row = el("div", "card");
      row.append(el("div", "card-label", m));
      row.append(el("div", "card-value", "stub — returns A2A_NOT_CONFIGURED"));
      center.append(row);
    }

    center.append(el("div", "section-title mt", "Tool Interop Adapters"));
    for (const [name, methods] of [
      ["Upterm", "share.upterm.start / stop"],
      ["Tmate", "share.tmate.start / stop"],
      ["ZMX", "zmx.checkpoint / restore"],
    ] as const) {
      const row = el("div", "card");
      row.append(el("div", "card-label", name));
      row.append(el("div", "card-value", methods));
      center.append(row);
    }
  } else if (activeTab === "chat") {
    const chatContainer = el("div", "chat-container");

    chatContainer.append(el("div", "section-title", "Agent Chat"));

    const chatLog = el("div", "chat-log");
    if (chatMessages.length === 0) {
      chatLog.append(
        el("div", "empty-state", "Send a message to interact with the agent boundary"),
      );
    } else {
      for (const msg of chatMessages) {
        const row = el("div", `chat-msg chat-${msg.role}`);
        row.append(el("span", "chat-ts", msg.ts));
        row.append(el("span", "chat-text", msg.text));
        chatLog.append(row);
      }
    }
    chatContainer.append(chatLog);

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
    inputRow.append(input);
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
    inputRow.append(sendBtn);
    chatContainer.append(inputRow);

    center.append(chatContainer);
  } else if (activeTab === "project") {
    center.append(el("div", "section-title", "Workspace"));
    const wsCard = el("div", "card");
    wsCard.append(el("div", "card-label", "Workspace ID"));
    wsCard.append(el("div", "card-value", ids.workspaceId ?? "—"));
    center.append(wsCard);

    if (rendererCaps) {
      center.append(el("div", "section-title mt", "Renderer Engine"));
      const engineCard = el("div", "card");
      engineCard.append(el("div", "card-label", "Active Engine"));
      engineCard.append(el("div", "card-value", rendererCaps.active_engine));
      center.append(engineCard);

      const availCard = el("div", "card");
      availCard.append(el("div", "card-label", "Available"));
      availCard.append(el("div", "card-value", rendererCaps.available_engines.join(", ")));
      center.append(availCard);

      center.append(el("div", "section-title mt", "Switch Engine"));
      for (const engine of rendererCaps.available_engines) {
        const isActive = engine === rendererCaps.active_engine;
        center.append(
          btn(
            `${engine}${isActive ? " (active)" : ""}`,
            () => doRendererSwitch(engine),
            busy || isActive,
          ),
        );
      }
    } else {
      center.append(
        el("div", "empty-state mt", "Run lifecycle to load renderer capabilities"),
      );
    }

    center.append(el("div", "section-title mt", "Multiplexer Adapters"));
    for (const [name, desc] of [
      ["PAR", "git worktree lane management (par CLI)"],
      ["Zellij", "terminal session multiplexer (zellij CLI)"],
    ] as const) {
      const row = el("div", "card");
      row.append(el("div", "card-label", name));
      row.append(el("div", "card-value", desc));
      center.append(row);
    }

    // Metrics dashboard
    if (metricsSummaries.length > 0) {
      center.append(el("div", "section-title mt", "Metrics Dashboard"));
      const metricsGrid = el("div", "metrics-grid");

      for (const m of metricsSummaries) {
        const card = el("div", "metric-card");
        card.append(el("div", "metric-name", m.metric.replaceAll(/_/g, " ")));
        card.append(el("div", "metric-value", `${m.p50}${m.unit}`));

        const stats = el("div", "metric-stats");
        stats.append(
          el("div", "metric-stat", `Min: <span class="metric-stat-value">${m.min}${m.unit}</span>`),
        );
        stats.append(
          el("div", "metric-stat", `Max: <span class="metric-stat-value">${m.max}${m.unit}</span>`),
        );
        stats.append(
          el("div", "metric-stat", `P95: <span class="metric-stat-value">${m.p95}${m.unit}</span>`),
        );
        stats.append(
          el("div", "metric-stat", `Count: <span class="metric-stat-value">${m.count}x</span>`),
        );

        card.append(stats);
        metricsGrid.append(card);
      }

      center.append(metricsGrid);
    }
  }

  // Right rail — event log + diagnostics
  const rightRail = el("div", "right-rail");
  rightRail.append(el("div", "section-title", "Event Log"));
  const logContainer = el("div", "event-log");
  for (const entry of [...eventLog].reverse().slice(0, 20)) {
    const row = el("div", `log-entry ${entry.ok ? "" : "log-error"}`);
    const icon = el("span", "log-icon", entry.ok ? "✓" : "✕");
    row.append(icon);
    row.append(el("span", "log-ts", entry.ts));
    row.append(el("span", "log-label", entry.label));
    logContainer.append(row);
  }
  if (eventLog.length === 0) {
    logContainer.append(el("div", "log-empty", "No events yet"));
  }
  rightRail.append(logContainer);

  // Audit trail
  if (auditEntries.length > 0) {
    rightRail.append(el("div", "section-title mt", "Audit Trail"));
    const auditContainer = el("div", "event-log");
    for (const entry of auditEntries.slice(0, 10)) {
      const row = el("div", "log-entry");
      row.append(el("span", "log-ts", entry.timestamp.slice(11, 19)));
      row.append(el("span", "log-label", `${entry.action}: ${entry.detail.slice(0, 40)}`));
      auditContainer.append(row);
    }
    rightRail.append(auditContainer);
  }

  rightRail.append(el("div", "section-title mt", "Diagnostics"));
  const diagnostics = [
    ["Runtime", runtimeState.lane.state !== "idle" ? "active" : "idle"],
    ["Transport", "cliproxy_harness"],
    ["Lane", runtimeState.lane.state],
    ["Session", runtimeState.session.state],
    ["Terminal", runtimeState.terminal.state],
  ];

  for (const [label, value] of diagnostics) {
    const card = el("div", "card");
    card.append(el("div", "card-label", label));
    let valueClass = "";
    if (value === "active") {
      valueClass = "status-ok";
    } else if (value === "error") {
      valueClass = "status-error";
    }
    card.append(el("div", `card-value ${valueClass}`, value));
    rightRail.append(card);
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
  statusItem.append(el("span", "statusbar-icon"));
  statusItem.append(el("span", undefined, `Helios — ${statusText}`));
  statusbar.append(statusItem);

  layout.append(topbar);
  layout.append(leftRail);
  layout.append(center);
  layout.append(rightRail);
  layout.append(statusbar);
  root.append(layout);

  // Render toasts
  for (const toast of toasts) {
    const toastEl = document.createElement("div");
    toastEl.className = `toast ${toast.type}`;
    let toastIcon = "⚠";
    if (toast.type === "success") {
      toastIcon = "✓";
    } else if (toast.type === "error") {
      toastIcon = "✕";
    }
    toastEl.append(el("span", "toast-icon", toastIcon));
    toastEl.append(el("span", "toast-message", toast.message));
    document.body.append(toastEl);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setupKeyboardShortcuts();
  render();
  await Promise.all([loadPersistedData(), loadMetrics(), loadRendererCaps()]);
  render();
});
