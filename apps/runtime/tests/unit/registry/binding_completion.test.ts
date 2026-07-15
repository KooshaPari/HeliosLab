import { describe, expect, it } from "bun:test";
import type { LocalBus } from "../../../src/protocol/bus.js";
import type { LocalBusEnvelope } from "../../../src/protocol/types.js";
import { BindingMiddleware } from "../../../src/registry/binding_middleware.js";
import type { RegistryQueryInterface } from "../../../src/registry/binding_triple.js";
import {
  InvalidBinding,
  TerminalRegistry,
} from "../../../src/registry/terminal_registry.js";

class TestBus {
  readonly events: LocalBusEnvelope[] = [];
  private readonly subscribers = new Map<
    string,
    Set<(event: LocalBusEnvelope) => void | Promise<void>>
  >();

  async publish(event: LocalBusEnvelope): Promise<void> {
    this.events.push(event);
    for (const handler of this.subscribers.get(event.topic ?? "") ?? []) await handler(event);
  }

  subscribe(
    topic: string,
    handler: (event: LocalBusEnvelope) => void | Promise<void>
  ): () => void {
    const handlers = this.subscribers.get(topic) ?? new Set();
    handlers.add(handler);
    this.subscribers.set(topic, handlers);
    return () => handlers.delete(handler);
  }
}

function lifecycleEvent(topic: string, ids: { laneId?: string; sessionId?: string }): LocalBusEnvelope {
  return {
    id: crypto.randomUUID(),
    type: "event",
    ts: new Date().toISOString(),
    topic,
    lane_id: ids.laneId,
    session_id: ids.sessionId,
    payload: {},
  };
}

function contextCatalog(): RegistryQueryInterface & {
  sessions: Set<string>;
} {
  const workspaces = new Set(["ws-1"]);
  const lanes = new Map([
    ["lane-1", "ws-1"],
    ["lane-2", "ws-1"],
  ]);
  const sessions = new Set(["session-1", "session-2"]);
  const sessionLanes = new Map([
    ["session-1", "lane-1"],
    ["session-2", "lane-2"],
  ]);
  return {
    sessions,
    workspaceExists: id => workspaces.has(id),
    laneExists: id => lanes.has(id),
    sessionExists: id => sessions.has(id),
    laneInWorkspace: (laneId, workspaceId) => lanes.get(laneId) === workspaceId,
    sessionInLane: (sessionId, laneId) => sessionLanes.get(sessionId) === laneId,
  };
}

describe("authoritative terminal binding integration", () => {
  it("rejects missing or mismatched lane/session ownership", () => {
    const registry = new TerminalRegistry({ queryInterface: contextCatalog() });

    expect(() =>
      registry.register("terminal-missing", {
        workspaceId: "ws-1",
        laneId: "lane-missing",
        sessionId: "session-1",
      })
    ).toThrow(InvalidBinding);
    expect(() =>
      registry.register("terminal-mismatch", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-1",
      })
    ).toThrow(InvalidBinding);
  });

  it("emits registry lifecycle events and unregisters on lane/session lifecycle", async () => {
    const bus = new TestBus();
    const registry = new TerminalRegistry({
      queryInterface: contextCatalog(),
      bus: bus as unknown as LocalBus,
    });
    registry.register("terminal-lane", {
      workspaceId: "ws-1",
      laneId: "lane-1",
      sessionId: "session-1",
    });
    registry.register("terminal-session", {
      workspaceId: "ws-1",
      laneId: "lane-2",
      sessionId: "session-2",
    });

    await bus.publish(lifecycleEvent("lane.closed", { laneId: "lane-1" }));
    expect(registry.get("terminal-lane")).toBeUndefined();
    expect(registry.get("terminal-session")).toBeDefined();

    await bus.publish(lifecycleEvent("session.terminated", { sessionId: "session-2" }));
    expect(registry.get("terminal-session")).toBeUndefined();
    expect(bus.events.map(event => event.topic)).toEqual(
      expect.arrayContaining([
        "terminal.binding.bound",
        "terminal.binding.unbound",
        "lane.closed",
        "session.terminated",
      ])
    );
    registry.dispose();
  });

  it("emits validation_failed when authoritative context becomes stale", () => {
    const bus = new TestBus();
    const catalog = contextCatalog();
    const registry = new TerminalRegistry({
      queryInterface: catalog,
      bus: bus as unknown as LocalBus,
    });
    registry.register("terminal-stale", {
      workspaceId: "ws-1",
      laneId: "lane-1",
      sessionId: "session-1",
    });
    catalog.sessions.delete("session-1");

    const result = new BindingMiddleware(registry).validateBeforeOperation("terminal-stale");

    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe("STALE_BINDING");
    expect(bus.events.some(event => event.topic === "terminal.binding.validation_failed")).toBe(
      true
    );
  });
});
