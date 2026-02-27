/**
 * Helios Renderer — minimal skeleton for Phase 1
 *
 * Displays workspace/lane/session status and tab surfaces.
 * Connects to the main process via helios RPC messages.
 */

type HeliosState = {
  lanes: Record<string, { state: string }>;
  sessions: Record<string, { state: string }>;
  terminals: Record<string, { state: string }>;
};

type ActiveTab = "terminal" | "agent" | "session" | "chat" | "project";

let currentState: HeliosState = { lanes: {}, sessions: {}, terminals: {} };
let activeTab: ActiveTab = "terminal";

const TABS: ActiveTab[] = ["terminal", "agent", "session", "chat", "project"];

/** Escape HTML to prevent XSS */
function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function render() {
  const root = document.getElementById("root");
  if (!root) return;

  // Clear existing content
  root.textContent = "";

  const laneCount = Object.keys(currentState.lanes).length;
  const sessionCount = Object.keys(currentState.sessions).length;
  const terminalCount = Object.keys(currentState.terminals).length;

  // Build layout using DOM APIs
  const layout = document.createElement("div");
  layout.className = "layout";

  // Top bar
  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const h1 = document.createElement("h1");
  h1.textContent = "helios";
  const statusSpan = document.createElement("span");
  statusSpan.className = "status";
  statusSpan.textContent = `lanes: ${laneCount} | sessions: ${sessionCount} | terminals: ${terminalCount}`;
  topbar.appendChild(h1);
  topbar.appendChild(statusSpan);

  // Left rail
  const leftRail = document.createElement("div");
  leftRail.className = "left-rail";
  const surfacesTitle = document.createElement("div");
  surfacesTitle.className = "section-title";
  surfacesTitle.textContent = "Surfaces";
  leftRail.appendChild(surfacesTitle);

  const tabList = document.createElement("ul");
  tabList.className = "tab-list";
  for (const t of TABS) {
    const li = document.createElement("li");
    li.textContent = t;
    if (t === activeTab) li.className = "active";
    li.addEventListener("click", () => {
      activeTab = t;
      render();
    });
    tabList.appendChild(li);
  }
  leftRail.appendChild(tabList);

  const lanesTitle = document.createElement("div");
  lanesTitle.className = "section-title";
  lanesTitle.style.marginTop = "16px";
  lanesTitle.textContent = "Lanes";
  leftRail.appendChild(lanesTitle);

  if (laneCount === 0) {
    const noLanes = document.createElement("div");
    noLanes.style.fontSize = "12px";
    noLanes.style.color = "#555";
    noLanes.textContent = "No active lanes";
    leftRail.appendChild(noLanes);
  } else {
    for (const [id, l] of Object.entries(currentState.lanes)) {
      const card = document.createElement("div");
      card.className = "card";
      const label = document.createElement("div");
      label.className = "card-label";
      label.textContent = id.slice(0, 8);
      const value = document.createElement("div");
      value.className = "card-value";
      value.textContent = l.state;
      card.appendChild(label);
      card.appendChild(value);
      leftRail.appendChild(card);
    }
  }

  // Center
  const center = document.createElement("div");
  center.className = "center";
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.textContent = `${activeTab} surface — awaiting workspace context`;
  center.appendChild(emptyState);

  // Right rail
  const rightRail = document.createElement("div");
  rightRail.className = "right-rail";
  const diagTitle = document.createElement("div");
  diagTitle.className = "section-title";
  diagTitle.textContent = "Diagnostics";
  rightRail.appendChild(diagTitle);

  for (const [label, value] of [
    ["Runtime", laneCount > 0 ? "active" : "idle"],
    ["Transport", "cliproxy_harness"],
  ] as const) {
    const card = document.createElement("div");
    card.className = "card";
    const cl = document.createElement("div");
    cl.className = "card-label";
    cl.textContent = label;
    const cv = document.createElement("div");
    cv.className = "card-value";
    cv.textContent = value;
    card.appendChild(cl);
    card.appendChild(cv);
    rightRail.appendChild(card);
  }

  // Status bar
  const statusbar = document.createElement("div");
  statusbar.className = "statusbar";
  statusbar.textContent = "helios runtime — phase 1 skeleton";

  layout.appendChild(topbar);
  layout.appendChild(leftRail);
  layout.appendChild(center);
  layout.appendChild(rightRail);
  layout.appendChild(statusbar);
  root.appendChild(layout);
}

// Listen for state updates from the main process via RPC
if (typeof window !== "undefined") {
  // @ts-ignore - ElectroBun injects RPC on the window
  const rpc = window.__electrobun_rpc;

  if (rpc) {
    rpc.on("helios:state", (data: { state: HeliosState }) => {
      currentState = data.state;
      render();
    });

    rpc.on("helios:event", (data: { event: unknown; state: HeliosState }) => {
      currentState = data.state;
      render();
    });
  }
}

document.addEventListener("DOMContentLoaded", render);
