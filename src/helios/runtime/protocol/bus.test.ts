import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryLocalBus } from "./bus";
import type { LocalBusEnvelope } from "./types";

describe("InMemoryLocalBus", () => {
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
  });

  // Helper to create a command envelope
  function createCommand(method: string, payload?: Record<string, unknown>): LocalBusEnvelope {
    return {
      id: `cmd-${Date.now()}`,
      type: "command",
      ts: new Date().toISOString(),
      method,
      payload,
      workspace_id: "ws-test",
      session_id: "sess-test",
      terminal_id: "term-test"
    };
  }

  // Helper to create an event envelope
  function createEvent(topic: string, payload?: Record<string, unknown>): LocalBusEnvelope {
    return {
      id: `evt-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
      workspace_id: "ws-test"
    };
  }

  describe("publish()", () => {
    it("should add event to eventLog", async () => {
      const event = createEvent("test.event");
      await bus.publish(event);
      const events = bus.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it("should maintain event log order", async () => {
      const event1 = createEvent("event1");
      const event2 = createEvent("event2");
      const event3 = createEvent("event3");

      await bus.publish(event1);
      await bus.publish(event2);
      await bus.publish(event3);

      const events = bus.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0].id).toBe(event1.id);
      expect(events[1].id).toBe(event2.id);
      expect(events[2].id).toBe(event3.id);
    });
  });

  describe("request() - lane.create", () => {
    it("should handle lane.create success", async () => {
      const command = createCommand("lane.create", { preferred_transport: "cliproxy_harness" });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toBeDefined();
      expect(response.result?.lane_id).toBeDefined();
      expect(typeof response.result?.lane_id).toBe("string");
      expect(response.result?.diagnostics).toBeDefined();
      expect(response.result?.diagnostics?.preferred_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.resolved_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.degraded_reason).toBeNull();
    });

    it("should handle lane.create with force_error", async () => {
      const command = createCommand("lane.create", { force_error: true });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("error");
      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe("LANE_CREATE_FAILED");
      expect(response.error?.message).toBe("lane.create failed");
      expect(response.error?.retryable).toBe(true);
      expect(response.error?.details?.method).toBe("lane.create");
    });

    it("should emit transition events for lane.create success", async () => {
      const command = createCommand("lane.create");
      await bus.request(command);

      const events = bus.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);

      const topics = events.map((e) => e.topic);
      expect(topics).toContain("lane.create.started");
      expect(topics).toContain("lane.created");
    });

    it("should emit transition events for lane.create failure", async () => {
      const command = createCommand("lane.create", { force_error: true });
      await bus.request(command);

      const events = bus.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);

      const topics = events.map((e) => e.topic);
      expect(topics).toContain("lane.create.started");
      expect(topics).toContain("lane.create.failed");
    });

    it("should generate lane_id with timestamp prefix by default", async () => {
      const cmd1 = createCommand("lane.create");
      const resp1 = await bus.request(cmd1);
      const laneId = resp1.result?.["lane_id"] as string;
      expect(laneId).toBeDefined();
      expect(laneId).toMatch(/^lane_id_\d+$/);
    });

    it("should use custom id from payload if provided", async () => {
      const command = createCommand("lane.create", { id: "custom-lane-123" });
      const response = await bus.request(command);

      expect(response.result?.lane_id).toBe("custom-lane-123");
    });
  });

  describe("request() - session.attach", () => {
    it("should handle session.attach success", async () => {
      const command = createCommand("session.attach", { preferred_transport: "cliproxy_harness" });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toBeDefined();
      expect(response.result?.session_id).toBeDefined();
      expect(typeof response.result?.session_id).toBe("string");
      expect(response.result?.diagnostics).toBeDefined();
    });

    it("should handle session.attach with force_error", async () => {
      const command = createCommand("session.attach", { force_error: true });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("error");
      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe("SESSION_ATTACH_FAILED");
      expect(response.error?.message).toBe("session.attach failed");
      expect(response.error?.retryable).toBe(true);
      expect(response.error?.details?.method).toBe("session.attach");
    });

    it("should emit transition events for session.attach success", async () => {
      const command = createCommand("session.attach");
      await bus.request(command);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);
      expect(topics).toContain("session.attach.started");
      expect(topics).toContain("session.attached");
    });

    it("should emit transition events for session.attach failure", async () => {
      const command = createCommand("session.attach", { force_error: true });
      await bus.request(command);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);
      expect(topics).toContain("session.attach.started");
      expect(topics).toContain("session.attach.failed");
    });
  });

  describe("request() - terminal.spawn", () => {
    it("should handle terminal.spawn success", async () => {
      const command = createCommand("terminal.spawn", { preferred_transport: "cliproxy_harness" });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toBeDefined();
      expect(response.result?.terminal_id).toBeDefined();
      expect(typeof response.result?.terminal_id).toBe("string");
      expect(response.result?.diagnostics).toBeDefined();
    });

    it("should handle terminal.spawn with force_error", async () => {
      const command = createCommand("terminal.spawn", { force_error: true });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("error");
      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe("TERMINAL_SPAWN_FAILED");
      expect(response.error?.message).toBe("terminal.spawn failed");
      expect(response.error?.retryable).toBe(true);
      expect(response.error?.details?.method).toBe("terminal.spawn");
    });

    it("should emit transition events for terminal.spawn success", async () => {
      const command = createCommand("terminal.spawn");
      await bus.request(command);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);
      expect(topics).toContain("terminal.spawn.started");
      expect(topics).toContain("terminal.spawned");
    });

    it("should emit transition events for terminal.spawn failure", async () => {
      const command = createCommand("terminal.spawn", { force_error: true });
      await bus.request(command);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);
      expect(topics).toContain("terminal.spawn.started");
      expect(topics).toContain("terminal.spawn.failed");
    });
  });

  describe("request() - renderer.capabilities", () => {
    it("should return renderer capabilities with ghostty as default engine", async () => {
      const command = createCommand("renderer.capabilities");
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toBeDefined();
      expect(response.result?.active_engine).toBe("ghostty");
      expect(response.result?.available_engines).toEqual(["ghostty", "rio"]);
      expect(response.result?.hot_swap_supported).toBe(true);
    });

    it("should return updated active_engine after renderer.switch", async () => {
      const switchCommand = createCommand("renderer.switch", { target_engine: "rio" });
      await bus.request(switchCommand);

      const capsCommand = createCommand("renderer.capabilities");
      const response = await bus.request(capsCommand);

      expect(response.result?.active_engine).toBe("rio");
    });
  });

  describe("request() - renderer.switch", () => {
    it("should switch to valid engine rio", async () => {
      const command = createCommand("renderer.switch", { target_engine: "rio" });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toBeDefined();
      expect(response.result?.active_engine).toBe("rio");
      expect(response.result?.previous_engine).toBe("ghostty");
    });

    it("should switch back to valid engine ghostty", async () => {
      // First switch to rio
      const switchToRio = createCommand("renderer.switch", { target_engine: "rio" });
      await bus.request(switchToRio);

      // Then switch back to ghostty
      const switchToGhostty = createCommand("renderer.switch", { target_engine: "ghostty" });
      const response = await bus.request(switchToGhostty);

      expect(response.status).toBe("ok");
      expect(response.result?.active_engine).toBe("ghostty");
      expect(response.result?.previous_engine).toBe("rio");
    });

    it("should reject invalid engine with error", async () => {
      const command = createCommand("renderer.switch", { target_engine: "invalid_engine" });
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("error");
      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe("RENDERER_SWITCH_FAILED");
      expect(response.error?.message).toBe("renderer.switch failed");
      expect(response.error?.retryable).toBe(true);
      expect(response.error?.details?.target_engine).toBe("invalid_engine");
    });

    it("should reject with force_error flag", async () => {
      const command = createCommand("renderer.switch", {
        target_engine: "rio",
        force_error: true
      });
      const response = await bus.request(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("RENDERER_SWITCH_FAILED");
      expect(response.result).toBeNull();
    });

    it("should emit renderer.switch.started event", async () => {
      const command = createCommand("renderer.switch", { target_engine: "rio" });
      await bus.request(command);

      const events = bus.getEvents();
      const switchStartedEvent = events.find((e) => e.topic === "renderer.switch.started");
      expect(switchStartedEvent).toBeDefined();
      expect(switchStartedEvent?.payload?.previous_engine).toBe("ghostty");
      expect(switchStartedEvent?.payload?.target_engine).toBe("rio");
    });

    it("should emit renderer.switch.succeeded event on success", async () => {
      const command = createCommand("renderer.switch", { target_engine: "rio" });
      await bus.request(command);

      const events = bus.getEvents();
      const switchSucceededEvent = events.find((e) => e.topic === "renderer.switch.succeeded");
      expect(switchSucceededEvent).toBeDefined();
      expect(switchSucceededEvent?.payload?.previous_engine).toBe("ghostty");
      expect(switchSucceededEvent?.payload?.active_engine).toBe("rio");
    });

    it("should emit renderer.switch.failed event on failure", async () => {
      const command = createCommand("renderer.switch", { target_engine: "invalid_engine" });
      await bus.request(command);

      const events = bus.getEvents();
      const switchFailedEvent = events.find((e) => e.topic === "renderer.switch.failed");
      expect(switchFailedEvent).toBeDefined();
      expect(switchFailedEvent?.payload?.reason).toBe("invalid_renderer_engine");
    });

    it("should not change active engine on failed switch", async () => {
      const invalidCommand = createCommand("renderer.switch", { target_engine: "invalid_engine" });
      await bus.request(invalidCommand);

      const capsCommand = createCommand("renderer.capabilities");
      const response = await bus.request(capsCommand);

      expect(response.result?.active_engine).toBe("ghostty");
    });
  });

  describe("request() - simulate_degrade flag", () => {
    it("should resolve to native_openai transport when simulate_degrade is true", async () => {
      const command = createCommand("lane.create", {
        preferred_transport: "cliproxy_harness",
        simulate_degrade: true
      });
      const response = await bus.request(command);

      expect(response.status).toBe("ok");
      expect(response.result?.diagnostics?.preferred_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.resolved_transport).toBe("native_openai");
      expect(response.result?.diagnostics?.degraded_reason).toBe("cliproxy_harness_unhealthy");
      expect(response.result?.diagnostics?.degraded_at).toBeDefined();
    });

    it("should keep preferred_transport when simulate_degrade is false", async () => {
      const command = createCommand("session.attach", {
        preferred_transport: "cliproxy_harness",
        simulate_degrade: false
      });
      const response = await bus.request(command);

      expect(response.status).toBe("ok");
      expect(response.result?.diagnostics?.preferred_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.resolved_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.degraded_reason).toBeNull();
      expect(response.result?.diagnostics?.degraded_at).toBeNull();
    });

    it("should use default transport when preferred_transport is not specified", async () => {
      const command = createCommand("terminal.spawn", { simulate_degrade: false });
      const response = await bus.request(command);

      expect(response.status).toBe("ok");
      expect(response.result?.diagnostics?.preferred_transport).toBe("cliproxy_harness");
      expect(response.result?.diagnostics?.resolved_transport).toBe("cliproxy_harness");
    });
  });

  describe("request() - unknown methods", () => {
    it("should return ok with empty result for unknown method", async () => {
      const command = createCommand("unknown.method");
      const response = await bus.request(command);

      expect(response.id).toBe(command.id);
      expect(response.type).toBe("response");
      expect(response.status).toBe("ok");
      expect(response.result).toEqual({});
    });

    it("should return ok with empty result for random unknown method", async () => {
      const command = createCommand("some.random.method.name");
      const response = await bus.request(command);

      expect(response.status).toBe("ok");
      expect(response.result).toEqual({});
    });

    it("should preserve command id for unknown methods", async () => {
      const commandId = "custom-id-xyz";
      const command: LocalBusEnvelope = {
        id: commandId,
        type: "command",
        ts: new Date().toISOString(),
        method: "undefined.method"
      };
      const response = await bus.request(command);

      expect(response.id).toBe(commandId);
    });
  });

  describe("getState()", () => {
    it("should return initial state", () => {
      const state = bus.getState();
      expect(state).toBeDefined();
      expect(typeof state).toBe("object");
    });

    it("should return consistent state across calls", () => {
      const state1 = bus.getState();
      const state2 = bus.getState();
      expect(state1).toEqual(state2);
    });

    it("should update state after lifecycle command success", async () => {
      const initialState = bus.getState();
      const command = createCommand("lane.create");
      await bus.request(command);
      const updatedState = bus.getState();

      expect(updatedState).toBeDefined();
      expect(updatedState).not.toEqual(initialState);
    });

    it("should include state in successful command response", async () => {
      const command = createCommand("session.attach");
      const response = await bus.request(command);

      expect(response.result?.state).toBeDefined();
      expect(response.result?.state).toEqual(bus.getState());
    });
  });

  describe("getEvents()", () => {
    it("should return empty array initially", () => {
      const events = bus.getEvents();
      expect(events).toEqual([]);
    });

    it("should return copy of event log not reference", async () => {
      const event = createEvent("test.event");
      await bus.publish(event);

      const events1 = bus.getEvents();
      const events2 = bus.getEvents();

      expect(events1).toEqual(events2);
      expect(events1).not.toBe(events2);
    });

    it("should include lifecycle events from successful requests", async () => {
      const command = createCommand("lane.create");
      await bus.request(command);

      const events = bus.getEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.topic === "lane.create.started")).toBe(true);
      expect(events.some((e) => e.topic === "lane.created")).toBe(true);
    });

    it("should include multiple command events", async () => {
      const cmd1 = createCommand("lane.create");
      const cmd2 = createCommand("session.attach");

      await bus.request(cmd1);
      await bus.request(cmd2);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);

      expect(topics).toContain("lane.create.started");
      expect(topics).toContain("lane.created");
      expect(topics).toContain("session.attach.started");
      expect(topics).toContain("session.attached");
    });

    it("should include renderer switch events", async () => {
      const command = createCommand("renderer.switch", { target_engine: "rio" });
      await bus.request(command);

      const events = bus.getEvents();
      const topics = events.map((e) => e.topic);

      expect(topics).toContain("renderer.switch.started");
      expect(topics).toContain("renderer.switch.succeeded");
    });
  });

  describe("state machine integration", () => {
    it("should track state transitions through multiple commands", async () => {
      const state1 = bus.getState();

      const cmd1 = createCommand("lane.create");
      await bus.request(cmd1);
      const state2 = bus.getState();

      const cmd2 = createCommand("session.attach");
      await bus.request(cmd2);
      const state3 = bus.getState();

      expect(state1).not.toEqual(state2);
      expect(state2).not.toEqual(state3);
    });

    it("should include state in lifecycle command responses", async () => {
      const command = createCommand("terminal.spawn");
      const response = await bus.request(command);

      expect(response.result?.state).toBeDefined();
      const currentState = bus.getState();
      expect(response.result?.state).toEqual(currentState);
    });

    it("should emit state in transition events", async () => {
      const command = createCommand("lane.create");
      await bus.request(command);

      const events = bus.getEvents();
      const transitionEvents = events.filter((e) => e.payload?.runtime_event);

      expect(transitionEvents.length).toBeGreaterThan(0);
      transitionEvents.forEach((event) => {
        expect(event.payload?.state).toBeDefined();
      });
    });
  });

  describe("concurrent operations", () => {
    it("should handle multiple concurrent publish calls", async () => {
      const event1 = createEvent("event1");
      const event2 = createEvent("event2");
      const event3 = createEvent("event3");

      await Promise.all([
        bus.publish(event1),
        bus.publish(event2),
        bus.publish(event3)
      ]);

      const events = bus.getEvents();
      expect(events).toHaveLength(3);
    });

    it("should handle multiple concurrent request calls", async () => {
      const cmd1 = createCommand("lane.create");
      const cmd2 = createCommand("session.attach");
      const cmd3 = createCommand("terminal.spawn");

      const [resp1, resp2, resp3] = await Promise.all([
        bus.request(cmd1),
        bus.request(cmd2),
        bus.request(cmd3)
      ]);

      expect(resp1.status).toBe("ok");
      expect(resp2.status).toBe("ok");
      expect(resp3.status).toBe("ok");
      expect(resp1.result?.lane_id).toBeDefined();
      expect(resp2.result?.session_id).toBeDefined();
      expect(resp3.result?.terminal_id).toBeDefined();
    });
  });

  describe("envelope metadata preservation", () => {
    it("should preserve workspace_id in event responses", async () => {
      const command = createCommand("lane.create");
      command.workspace_id = "custom-ws-123";
      await bus.request(command);

      const events = bus.getEvents();
      const transitionEvent = events.find((e) => e.topic === "lane.create.started");
      expect(transitionEvent?.workspace_id).toBe("custom-ws-123");
    });

    it("should preserve session_id in event responses", async () => {
      const command = createCommand("session.attach");
      command.session_id = "custom-sess-456";
      await bus.request(command);

      const events = bus.getEvents();
      const transitionEvent = events.find((e) => e.topic === "session.attach.started");
      expect(transitionEvent?.session_id).toBe("custom-sess-456");
    });

    it("should preserve terminal_id in event responses", async () => {
      const command = createCommand("terminal.spawn");
      command.terminal_id = "custom-term-789";
      await bus.request(command);

      const events = bus.getEvents();
      const transitionEvent = events.find((e) => e.topic === "terminal.spawn.started");
      expect(transitionEvent?.terminal_id).toBe("custom-term-789");
    });
  });
});
