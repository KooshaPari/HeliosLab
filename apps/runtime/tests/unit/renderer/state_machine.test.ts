/**
 * Unit tests for RendererStateMachine.
 * @see FR-010-003
 * Traces to: FR-RND-002 (renderer state machine: uninitialized -> initializing -> running -> switching -> stopping -> stopped -> errored)
 */
import { describe, expect, it } from "bun:test";
import {
  RendererStateMachine,
  InvalidRendererTransitionError,
  transition,
} from "../../../src/renderer/state_machine.js";


describe("RendererStateMachine", () => {
  it("starts in uninitialized state", () => {
    const sm = new RendererStateMachine();
    expect(sm.state).toBe("uninitialized");
  });

  it("transitions uninitialized -> initializing on init", () => {
    const sm = new RendererStateMachine();
    expect(sm.transition("init")).toBe("initializing");
    expect(sm.state).toBe("initializing");
  });

  it("transitions initializing -> running on init_success", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    expect(sm.transition("init_success")).toBe("running");
  });

  it("transitions initializing -> errored on init_failure", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    expect(sm.transition("init_failure")).toBe("errored");
  });

  it("transitions running -> switching on switch_request", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    expect(sm.transition("switch_request")).toBe("switching");
  });

  it("transitions running -> stopping on stop_request", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    expect(sm.transition("stop_request")).toBe("stopping");
  });

  it("transitions running -> errored on crash", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    expect(sm.transition("crash")).toBe("errored");
  });

  it("transitions switching -> running on switch_success", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    expect(sm.transition("switch_success")).toBe("running");
  });

  it("transitions switching -> running on switch_rollback", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    expect(sm.transition("switch_rollback")).toBe("running");
  });

  it("transitions switching -> errored on switch_failure", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    expect(sm.transition("switch_failure")).toBe("errored");
  });

  it("transitions stopping -> stopped on stop_complete", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("stop_request");
    expect(sm.transition("stop_complete")).toBe("stopped");
  });

  it("transitions errored -> initializing on recovery_attempt", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_failure");
    expect(sm.transition("recovery_attempt")).toBe("initializing");
  });

  it("transitions errored -> stopped on give_up", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_failure");
    expect(sm.transition("give_up")).toBe("stopped");
  });

  it("stopped state has no valid transitions", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("stop_request");
    sm.transition("stop_complete");

    const events: RendererEvent[] = [
      "init",
      "init_success",
      "init_failure",
      "switch_request",
      "stop_request",
      "crash",
      "switch_success",
      "switch_rollback",
      "switch_failure",
      "stop_complete",
      "recovery_attempt",
      "give_up",
    ];

    for (const event of events) {
      expect(() => sm.transition(event)).toThrow(InvalidRendererTransitionError);
    }
  });

  it("throws InvalidRendererTransitionError for invalid transitions", () => {
    const sm = new RendererStateMachine();
    expect(() => sm.transition("init_success")).toThrow(InvalidRendererTransitionError);
    expect(() => sm.transition("switch_request")).toThrow(InvalidRendererTransitionError);
    expect(() => sm.transition("stop_request")).toThrow(InvalidRendererTransitionError);
  });

  it("records transition history", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");

    expect(sm.history.length).toBe(2);
    expect(sm.history[0]!.from).toBe("uninitialized");
    expect(sm.history[0]!.to).toBe("initializing");
    expect(sm.history[0]!.event).toBe("init");
    expect(sm.history[1]!.from).toBe("initializing");
    expect(sm.history[1]!.to).toBe("running");
  });

  it("limits history to 10 entries", () => {
    const sm2 = new RendererStateMachine();
    sm2.transition("init");
    sm2.transition("init_failure");
    sm2.transition("recovery_attempt");
    sm2.transition("init_failure");
    sm2.transition("recovery_attempt");
    sm2.transition("init_failure");
    sm2.transition("recovery_attempt");
    sm2.transition("init_failure");
    sm2.transition("recovery_attempt");
    sm2.transition("init_failure");
    sm2.transition("recovery_attempt");
    sm2.transition("init_success");

    expect(sm2.history.length).toBeLessThanOrEqual(10);
  });

  it("history entries have timestamps", () => {
    const sm = new RendererStateMachine();
    const _before = Date.now();
    sm.transition("init");
    const after = Date.now();

    expect(sm.history[0]!.timestamp).toBeGreaterThanOrEqual(_before);
    expect(sm.history[0]!.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("transition (pure function)", () => {
  it("returns next state for valid transitions", () => {
    expect(transition("uninitialized", "init")).toBe("initializing");
    expect(transition("initializing", "init_success")).toBe("running");
    expect(transition("running", "switch_request")).toBe("switching");
  });

  it("throws for invalid transitions", () => {
    expect(() => transition("uninitialized", "init_success")).toThrow(
      InvalidRendererTransitionError
    );
    expect(() => transition("stopped", "init")).toThrow(InvalidRendererTransitionError);
  });
});
