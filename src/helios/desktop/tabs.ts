import type { ActiveContextState, ActiveTab } from "./context_store";
import { selectActiveContext } from "./context_store";

export type TabViewState = "empty" | "loading" | "ready" | "error";

export type TabSurface = {
  tab: ActiveTab;
  title: string;
  state: TabViewState;
  message: string;
  context: ReturnType<typeof selectActiveContext>;
  diagnostics: {
    resolvedTransport: string;
    degradedReason: string | null;
  };
};

const TAB_TITLES: Record<ActiveTab, string> = {
  terminal: "Terminal",
  agent: "Agent",
  session: "Session",
  chat: "Chat",
  project: "Project"
};

function deriveTabState(state: ActiveContextState): TabViewState {
  if (state.operations.error) {
    return "error";
  }
  if (state.operations.lane === "loading" || state.operations.session === "loading" || state.operations.terminal === "loading") {
    return "loading";
  }
  if (!state.workspaceId || !state.laneId || !state.sessionId) {
    return "empty";
  }
  return "ready";
}

function deriveMessage(tab: ActiveTab, state: ActiveContextState): string {
  const tabState = deriveTabState(state);
  if (tabState === "error") {
    return state.operations.error ?? `${TAB_TITLES[tab]} failed`;
  }
  if (tabState === "loading") {
    return `${TAB_TITLES[tab]} syncing active context`;
  }
  if (tabState === "empty") {
    return `${TAB_TITLES[tab]} awaiting workspace/lane/session`;
  }
  return `${TAB_TITLES[tab]} bound to active context`;
}

export function buildTabSurface(state: ActiveContextState, tab: ActiveTab): TabSurface {
  return {
    tab,
    title: TAB_TITLES[tab],
    state: deriveTabState(state),
    message: deriveMessage(tab, state),
    context: selectActiveContext(state),
    diagnostics: {
      resolvedTransport: state.diagnostics.resolvedTransport,
      degradedReason: state.diagnostics.degradedReason
    }
  };
}

export function buildAllTabSurfaces(state: ActiveContextState): Record<ActiveTab, TabSurface> {
  return {
    terminal: buildTabSurface(state, "terminal"),
    agent: buildTabSurface(state, "agent"),
    session: buildTabSurface(state, "session"),
    chat: buildTabSurface(state, "chat"),
    project: buildTabSurface(state, "project")
  };
}

