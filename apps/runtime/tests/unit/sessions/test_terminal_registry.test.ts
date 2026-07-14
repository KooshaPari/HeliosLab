import { describe, expect, test } from "bun:test";

import { TerminalRegistry } from "../../../src/sessions/terminal_registry";

// Traces to: FR-MVP-001 (chat interface), FR-MVP-008 (multiple terminals), FR-MVP-009 (execute in terminal)

describe("TerminalRegistry", () => {
  test("stores and queries terminal context", () => {
    const _registry = new TerminalRegistry();
    const terminal = registry.spawn({
      terminal_id: "t-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
      title: "Alpha",
    });

    expect(terminal.state).toBe("spawning");
    expect(registry.get("t-1")?.session_id).toBe("sess-1");
    expect(registry.listBySession("sess-1")).toHaveLength(1);
  });

  test("enforces ownership boundaries for workspace lane session", () => {
    const _registry = new TerminalRegistry();
    registry.spawn({
      terminal_id: "t-2",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
    });

    expect(
      registry.isOwnedBy("t-2", {
        workspace_id: "ws-1",
        lane_id: "lane-1",
        session_id: "sess-1",
      })
    ).toBe(true);
    expect(
      registry.isOwnedBy("t-2", {
        workspace_id: "ws-1",
        lane_id: "lane-2",
        session_id: "sess-1",
      })
    ).toBe(false);
  });

  test("cleans up session scoped terminals", () => {
    const _registry = new TerminalRegistry();
    registry.spawn({
      terminal_id: "t-3",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
    });
    registry.spawn({
      terminal_id: "t-4",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
    });

    registry.removeBySession("sess-1");

    expect(registry.get("t-3")).toBeUndefined();
    expect(registry.get("t-4")).toBeUndefined();
    expect(registry.listBySession("sess-1")).toHaveLength(0);
  });

  test("re-indexes terminal ownership when terminal_id is reused", () => {
    const _registry = new TerminalRegistry();
    registry.spawn({
      terminal_id: "t-5",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
    });
    registry.spawn({
      terminal_id: "t-5",
      workspace_id: "ws-1",
      lane_id: "lane-2",
      session_id: "sess-2",
    });

    expect(registry.listBySession("sess-1")).toHaveLength(0);
    expect(registry.listBySession("sess-2")).toHaveLength(1);
    expect(registry.listBySession("sess-2")[0]?.lane_id).toBe("lane-2");
  });
});
