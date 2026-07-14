import { describe, expect, it } from "bun:test";
import {
  transition,
  PtyLifecycle,
  InvalidTransitionError,
  type PtyState,
  type PtyEvent,
} from "../state_machine.js";

// Traces to: FR-PTY-001 (state machine with states)
describe("transition()", () => {
  const validTransitions: [PtyState, PtyEvent, PtyState][] = [
    ["idle", "spawn_requested", "spawning"],
    ["spawning", "spawn_succeeded", "active"],
    ["spawning", "spawn_failed", "errored"],
    ["active", "idle_timeout", "throttled"],
    ["active", "unexpected_exit", "errored"],
    ["active", "graceful_terminate", "stopped"],
    ["throttled", "output_resume", "active"],
    ["throttled", "terminate", "stopped"],
    ["errored", "cleanup", "stopped"],
  ];

  it.each(validTransitions)("%s + %s -> %s", (from, event, expected) => {
    expect(transition(from, event, "test-pty")).toBe(expected);
  });

  it("rejects invalid transitions with InvalidTransitionError", () => {
    expect(() => transition("idle", "spawn_succeeded", "pty-1")).toThrow(InvalidTransitionError);
  });

  it("includes diagnostic context in error", () => {
    try {
      transition("stopped", "spawn_requested", "pty-42");
      throw new Error("should have thrown");
    } catch {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.ptyId).toBe("pty-42");
      expect(err.currentState).toBe("stopped");
      expect(err.event).toBe("spawn_requested");
      expect(err.message).toContain("pty-42");
      expect(err.message).toContain("stopped");
      expect(err.message).toContain("spawn_requested");
    }
  });

  it("stopped has no outgoing transitions", () => {
    const events: PtyEvent[] = [
      "spawn_requested",
      "spawn_succeeded",
      "spawn_failed",
      "idle_timeout",
      "unexpected_exit",
      "graceful_terminate",
      "output_resume",
      "terminate",
      "cleanup",
    ];
    for (const event of events) {
      expect(() => transition("stopped", event, "pty-x")).toThrow(InvalidTransitionError);
    }
  });
});

describe("PtyLifecycle", () => {
  it("starts in idle state by default", () => {
    const lc = new PtyLifecycle("pty-1");
    expect(lc.state).toBe("idle");
    expect(lc.ptyId).toBe("pty-1");
  });

  it("tracks transition history", () => {
    const lc = new PtyLifecycle("pty-1");
    lc.apply("spawn_requested");
    lc.apply("spawn_succeeded");

    expect(lc.state).toBe("active");
    expect(lc.history).toHaveLength(2);
    expect(lc.history[0]!.from).toBe("idle");
    expect(lc.history[0]!.to).toBe("spawning");
    expect(lc.history[1]!.from).toBe("spawning");
    expect(lc.history[1]!.to).toBe("active");
  });

  it("bounds history to 10 entries", () => {
    const lc = new PtyLifecycle("pty-1");
    // Cycle through active/throttled many times
    lc.apply("spawn_requested");
    lc.apply("spawn_succeeded");
    for (let i = 0; i < 10; i++) {
      lc.apply("idle_timeout");
      lc.apply("output_resume");
    }
    // 2 initial + 20 cycles = 22 total, should be capped at 10
    expect(lc.history.length).toBeLessThanOrEqual(10);
  });

  it("throws InvalidTransitionError on invalid apply", () => {
    const lc = new PtyLifecycle("pty-1");
    expect(() => lc.apply("spawn_succeeded")).toThrow(InvalidTransitionError);
    // State should not have changed
    expect(lc.state).toBe("idle");
  });
});
