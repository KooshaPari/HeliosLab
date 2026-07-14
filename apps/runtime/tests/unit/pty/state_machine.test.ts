import { describe, expect, it } from "bun:test";
import {
  transition,
  PtyLifecycle,
  InvalidTransitionError,
  type PtyState,
  type PtyEvent,
} from "../../../src/pty/state_machine.js";

// Traces to: FR-MVP-006 (spawn PTY), FR-MVP-008 (multiple terminals), FR-MVP-010 (terminal resize)

// ── All valid transitions ────────────────────────────────────────────────────

const VALID_TRANSITIONS: [PtyState, PtyEvent, PtyState][] = [
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

const ALL_STATES: PtyState[] = ["idle", "spawning", "active", "throttled", "errored", "stopped"];

const ALL_EVENTS: PtyEvent[] = [
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

describe("transition() — every valid transition", () => {
  it.each(VALID_TRANSITIONS)("%s + %s -> %s", (from, event, expected) => {
    expect(transition(from, event, "test-pty")).toBe(expected);
  });
});

describe("transition() — every invalid transition", () => {
  // Build the set of valid (state, event) pairs for quick lookup.
  const validSet = new Set(VALID_TRANSITIONS.map(([s, e]) => `${s}:${e}`));

  const invalidCombos: [PtyState, PtyEvent][] = [];
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      if (!validSet.has(`${state}:${event}`)) {
        invalidCombos.push([state, event]);
      }
    }
  }

  it.each(invalidCombos)("%s + %s throws InvalidTransitionError", (state, event) => {
    expect(() => transition(state, event, "pty-invalid")).toThrow(InvalidTransitionError);
  });
});

describe("transition() — error diagnostics", () => {
  it("error includes ptyId, currentState, event, and descriptive message", () => {
    try {
      transition("stopped", "spawn_requested", "pty-42");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.ptyId).toBe("pty-42");
      expect(err.currentState).toBe("stopped");
      expect(err.event).toBe("spawn_requested");
      expect(err.message).toContain("pty-42");
    }
  });
});

describe("PtyLifecycle — full lifecycle path", () => {
  it("idle -> spawning -> active -> throttled -> active -> stopped", () => {
    const lc = new PtyLifecycle("pty-1");
    expect(lc.state).toBe("idle");

    expect(lc.apply("spawn_requested")).toBe("spawning");
    expect(lc.apply("spawn_succeeded")).toBe("active");
    expect(lc.apply("idle_timeout")).toBe("throttled");
    expect(lc.apply("output_resume")).toBe("active");
    expect(lc.apply("graceful_terminate")).toBe("stopped");

    expect(lc.history).toHaveLength(5);
  });

  it("idle -> spawning -> errored -> stopped", () => {
    const lc = new PtyLifecycle("pty-2");
    lc.apply("spawn_requested");
    lc.apply("spawn_failed");
    expect(lc.state).toBe("errored");
    lc.apply("cleanup");
    expect(lc.state).toBe("stopped");
  });

  it("bounds history to 10 entries", () => {
    const lc = new PtyLifecycle("pty-1");
    lc.apply("spawn_requested");
    lc.apply("spawn_succeeded");
    for (let i = 0; i < 12; i++) {
      lc.apply("idle_timeout");
      lc.apply("output_resume");
    }
    expect(lc.history.length).toBeLessThanOrEqual(10);
  });

  it("does not change state on invalid apply", () => {
    const lc = new PtyLifecycle("pty-1");
    expect(() => lc.apply("spawn_succeeded")).toThrow(InvalidTransitionError);
    expect(lc.state).toBe("idle");
  });

  it("accepts custom initial state", () => {
    const lc = new PtyLifecycle("pty-1", "active");
    expect(lc.state).toBe("active");
  });
});
