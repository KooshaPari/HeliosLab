// FR-001: Local Bus Decoupled Dispatch (context store consumes bus events via ILocalBusPort)
// FR-003: Workspace Isolation (active context is scoped to workspace/lane/session)
// Traces to: ILocalBusPort (event subscription), IWorkspacePort (workspace context)
import { describe, expect, test } from "bun:test";
import {
  ActiveContextStore,
  INITIAL_ACTIVE_CONTEXT_STATE,
  selectActiveContext,
  selectRendererSwitchStatus,
} from "../../src/context_store";

describe("ActiveContextStore", () => {
  test("keeps a single active context across tab switches", () => {
    const store = new ActiveContextStore(INITIAL_ACTIVE_CONTEXT_STATE);

    store.dispatch({ type: "workspace.set", workspaceId: "ws_1" });
    store.dispatch({ type: "lane.set", laneId: "lane_1" });
    store.dispatch({ type: "session.set", sessionId: "session_1" });
    store.dispatch({ type: "tab.set", tab: "chat" });
    store.dispatch({ type: "tab.set", tab: "project" });

    expect(selectActiveContext(store.getState())).toEqual({
      workspaceId: "ws_1",
      laneId: "lane_1",
      sessionId: "session_1",
      terminalId: null,
      activeTab: "project",
    });
  });

  test("tracks renderer switch rollback status", () => {
    const store = new ActiveContextStore(INITIAL_ACTIVE_CONTEXT_STATE);
    store.dispatch({
      type: "renderer.switch.started",
      previousEngine: "ghostty",
      targetEngine: "rio",
    });
    store.dispatch({
      type: "renderer.switch.rolled_back",
      engine: "ghostty",
      message: "renderer rollback to ghostty applied",
    });

    const status = selectRendererSwitchStatus(store.getState());
    expect(status.lastStatus).toBe("rolled_back");
    expect(status.targetEngine).toBe("ghostty");
  });
});
