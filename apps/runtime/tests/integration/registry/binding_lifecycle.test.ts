/**
 * FR-HELIOS-109: Terminal Binding Lifecycle Integration Tests
 * Verifies: FR-BND-001 (Terminal-to-lane-session binding)
 */
import { TerminalRegistry } from "../../../src/registry/terminal_registry.js";
import { BindingEventEmitter } from "../../../src/registry/binding_events.js";
import { InMemoryLocalBus } from "../../../src/protocol/bus.js";
import type { BindingTriple } from "../../../src/registry/binding_triple.js";
import { BindingState } from "../../../src/registry/binding_triple.js";

describe("Binding Lifecycle Integration", () => {
  let registry: TerminalRegistry;
  let bus: InMemoryLocalBus;
  let emitter: BindingEventEmitter;

  beforeEach(() => {
    registry = new TerminalRegistry();
    bus = new InMemoryLocalBus();
    emitter = new BindingEventEmitter(bus);
  });

  afterEach(() => {
    // Clear shared registry state between tests to prevent cross-test pollution
    registry.clear();
    if ("clear" in bus) {
      (bus as any)["_events"] = [];
      (bus as any)["_handlers"] = [];
    }
  });

  describe("full lifecycle", () => {
    it("should emit bound event on register", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      await emitter.emitBound(binding);

      const events = bus.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe("terminal.binding.bound");
      expect(events[0].terminal_id).toBe("terminal-1");
    });

    it("should emit rebound event on rebind", async () => {
      const oldTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const newTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-2",
      };

      const _binding = registry.register("terminal-1", oldTriple);
      await emitter.emitBound(binding);

      const rebound = registry.rebind("terminal-1", newTriple);
      await emitter.emitRebound(rebound, oldTriple);

      const events = bus.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].topic).toBe("terminal.binding.bound");
      expect(events[1].topic).toBe("terminal.binding.rebound");
      expect((events[1].payload as any).previousBinding).toEqual(oldTriple);
      expect((events[1].payload as any).binding).toEqual(newTriple);
    });

    it("should emit unbound event on unregister", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      await emitter.emitBound(binding);

      // Get binding before unregister
      const boundBinding = registry.get("terminal-1");
      registry.unregister("terminal-1");
      await emitter.emitUnbound(boundBinding!);

      const events = bus.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].topic).toBe("terminal.binding.bound");
      expect(events[1].topic).toBe("terminal.binding.unbound");
    });

    it("should track state transitions", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      expect(binding.state).toBe(BindingState.bound);

      const rebound = registry.rebind("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-2",
      });
      expect(rebound.state).toBe(BindingState.rebound);
    });
  });

  describe("concurrent binding changes", () => {
    it("should handle multiple simultaneous terminal registrations", async () => {
      const triples: BindingTriple[] = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: "ws-1",
        laneId: `lane-${i % 3}`,
        sessionId: `session-${i}`,
      }));

      const bindings = triples.map((triple, i) => registry.register(`terminal-${i}`, triple));

      for (const binding of bindings) {
        await emitter.emitBound(binding);
      }

      const events = bus.getEvents();
      expect(events).toHaveLength(10);
      expect(events.every(e => e.topic === "terminal.binding.bound")).toBe(true);
    });

    it("should maintain consistency with rapid rebinds", async () => {
      const terminal = "terminal-1";
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register(terminal, triple);
      await emitter.emitBound(binding);

      // Rapid rebinds
      for (let i = 0; i < 5; i++) {
        const newTriple: BindingTriple = {
          workspaceId: "ws-1",
          laneId: `lane-${i + 2}`,
          sessionId: `session-${i + 2}`,
        };

        const rebound = registry.rebind(terminal, newTriple);
        await emitter.emitRebound(rebound, binding.binding);
      }

      const events = bus.getEvents();
      expect(events).toHaveLength(6); // 1 bound + 5 rebound
      expect(events[0].topic).toBe("terminal.binding.bound");
      expect(events.slice(1).every(e => e.topic === "terminal.binding.rebound")).toBe(true);

      const finalBinding = registry.get(terminal);
      expect(finalBinding?.binding.laneId).toBe("lane-6");
    });
  });

  describe("binding consistency after rapid lane switches", () => {
    it("should maintain accurate binding state after lane switches", async () => {
      const terminal = "terminal-1";
      let _binding = registry.register(terminal, {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });

      // Simulate lane switches
      const switches = [
        { lane: "lane-2", session: "session-2" },
        { lane: "lane-3", session: "session-3" },
        { lane: "lane-1", session: "session-4" }, // back to lane-1
        { lane: "lane-2", session: "session-5" },
      ];

      for (const { lane, session } of switches) {
        binding = registry.rebind(terminal, {
          workspaceId: "ws-1",
          laneId: lane,
          sessionId: session,
        });
      }

      // Verify final state
      const finalBinding = registry.get(terminal);
      expect(finalBinding?.binding.laneId).toBe("lane-2");
      expect(finalBinding?.binding.sessionId).toBe("session-5");
      expect(finalBinding?.state).toBe(BindingState.rebound);

      // Verify indexes
      const byLane = registry.getByLane("lane-2");
      expect(byLane).toHaveLength(1);
      expect(byLane[0].terminalId).toBe(terminal);

      const bySession = registry.getBySession("session-5");
      expect(bySession).toHaveLength(1);
      expect(bySession[0].terminalId).toBe(terminal);
    });
  });

  describe("event payload structure", () => {
    it("should include complete metadata in event payloads", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      const correlationId = "corr-123";
      await emitter.emitBound(binding, correlationId);

      const events = bus.getEvents();
      const event = events[0];

      expect(event.workspace_id).toBe("ws-1");
      expect(event.lane_id).toBe("lane-1");
      expect(event.session_id).toBe("session-1");
      expect(event.terminal_id).toBe("terminal-1");
      expect((event.payload as any).correlationId).toBe(correlationId);
      expect((event.payload as any).state).toBe(BindingState.bound);
      expect((event.payload as any).binding).toEqual(triple);
    });
  });
});
