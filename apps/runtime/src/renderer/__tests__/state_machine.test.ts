import { describe, expect, it } from "bun:test";
import {
  RendererStateMachine,
  InvalidRendererTransitionError,
  transition,
} from "../state_machine.js";


// Traces to: FR-RND-002 (renderer state machine)
describe("RendererStateMachine", () => {
  it("starts in uninitialized state", () => {
    const sm = new RendererStateMachine();
    expect(sm.state).toBe("uninitialized");
  });

  it("transitions through happy path: init -> running -> stopping -> stopped", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    expect(sm.state).toBe("initializing");
    sm.transition("init_success");
    expect(sm.state).toBe("running");
    sm.transition("stop_request");
    expect(sm.state).toBe("stopping");
    sm.transition("stop_complete");
    expect(sm.state).toBe("stopped");
  });

  it("transitions through switch path", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    expect(sm.state).toBe("switching");
    sm.transition("switch_success");
    expect(sm.state).toBe("running");
  });

  it("handles switch rollback", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    sm.transition("switch_rollback");
    expect(sm.state).toBe("running");
  });

  it("handles switch failure (double fault)", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    sm.transition("switch_failure");
    expect(sm.state).toBe("errored");
  });

  it("handles crash -> recovery", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("crash");
    expect(sm.state).toBe("errored");
    sm.transition("recovery_attempt");
    expect(sm.state).toBe("initializing");
  });

  it("handles errored -> give_up -> stopped", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_failure");
    expect(sm.state).toBe("errored");
    sm.transition("give_up");
    expect(sm.state).toBe("stopped");
  });

  it("rejects invalid transitions", () => {
    const sm = new RendererStateMachine();
    expect(() => sm.transition("init_success")).toThrow(InvalidRendererTransitionError);
  });

  it("rejects switch during switch", () => {
    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");
    sm.transition("switch_request");
    expect(() => sm.transition("switch_request")).toThrow(InvalidRendererTransitionError);
  });

  it("tracks transition history (max 10)", () => {
    const sm = new RendererStateMachine();
    // Generate 12 transitions by cycling through recovery
    const events: RendererEvent[] = [
      "init",
      "init_failure",
      "recovery_attempt",
      "init_failure",
      "recovery_attempt",
      "init_failure",
      "recovery_attempt",
      "init_failure",
      "recovery_attempt",
      "init_failure",
      "recovery_attempt",
      "init_success",
    ];
    for (const e of events) {
      sm.transition(e);
    }
    expect(sm.history.length).toBe(10);
    // First two (init, init_failure) should have been evicted
    expect(sm.history[0]!.event).toBe("recovery_attempt");
  });
});

describe("transition (pure function)", () => {
  it("returns next state for valid transition", () => {
    expect(transition("uninitialized", "init")).toBe("initializing");
    expect(transition("running", "crash")).toBe("errored");
  });

  it("throws for invalid transition", () => {
    expect(() => transition("stopped", "init")).toThrow(InvalidRendererTransitionError);
  });
});
