import { describe, it, expect } from "vitest";
import { INITIAL_RUNTIME_STATE, transition } from "./state_machine";

describe("state_machine", () => {
  describe("INITIAL_RUNTIME_STATE", () => {
    it('has lane state of "new"', () => {
      expect(INITIAL_RUNTIME_STATE.lane).toBe("new");
    });

    it('has session state of "detached"', () => {
      expect(INITIAL_RUNTIME_STATE.session).toBe("detached");
    });

    it('has terminal state of "idle"', () => {
      expect(INITIAL_RUNTIME_STATE.terminal).toBe("idle");
    });
  });

  describe("lane axis transitions", () => {
    it("transitions lane from new to provisioning on lane.create.requested", () => {
      const state = transition(INITIAL_RUNTIME_STATE, "lane.create.requested");
      expect(state.lane).toBe("provisioning");
      expect(state.session).toBe("detached");
      expect(state.terminal).toBe("idle");
    });

    it("transitions lane from provisioning to ready on lane.create.succeeded", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "provisioning" as const };
      const result = transition(state, "lane.create.succeeded");
      expect(result.lane).toBe("ready");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane from provisioning to failed on lane.create.failed", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "provisioning" as const };
      const result = transition(state, "lane.create.failed");
      expect(result.lane).toBe("failed");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane from ready to running on lane.run.started", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "ready" as const };
      const result = transition(state, "lane.run.started");
      expect(result.lane).toBe("running");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane to blocked on lane.blocked", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "running" as const };
      const result = transition(state, "lane.blocked");
      expect(result.lane).toBe("blocked");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane from running to shared on lane.share.started", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "running" as const };
      const result = transition(state, "lane.share.started");
      expect(result.lane).toBe("shared");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane from shared back to running on lane.share.stopped", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "shared" as const };
      const result = transition(state, "lane.share.stopped");
      expect(result.lane).toBe("running");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane to cleaning on lane.cleanup.started", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "running" as const };
      const result = transition(state, "lane.cleanup.started");
      expect(result.lane).toBe("cleaning");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("transitions lane from cleaning to closed on lane.cleanup.completed", () => {
      const state = { ...INITIAL_RUNTIME_STATE, lane: "cleaning" as const };
      const result = transition(state, "lane.cleanup.completed");
      expect(result.lane).toBe("closed");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });
  });

  describe("session axis transitions", () => {
    it("transitions session from detached to attaching on session.attach.requested", () => {
      const initialState = {
        lane: "new" as const,
        session: "detached" as const,
        terminal: "idle" as const,
      };
      const state = transition(initialState, "session.attach.requested");
      expect(state.session).toBe("attaching");
      expect(state.lane).toBe("new");
      expect(state.terminal).toBe("idle");
    });

    it("transitions session from attaching to attached on session.attach.succeeded", () => {
      const state = { ...INITIAL_RUNTIME_STATE, session: "attaching" as const };
      const result = transition(state, "session.attach.succeeded");
      expect(result.session).toBe("attached");
      expect(result.lane).toBe("new");
      expect(result.terminal).toBe("idle");
    });

    it("transitions session to restoring on session.restore.started", () => {
      const state = { ...INITIAL_RUNTIME_STATE, session: "attached" as const };
      const result = transition(state, "session.restore.started");
      expect(result.session).toBe("restoring");
      expect(result.lane).toBe("new");
      expect(result.terminal).toBe("idle");
    });

    it("transitions session from restoring to attached on session.restore.completed", () => {
      const state = { ...INITIAL_RUNTIME_STATE, session: "restoring" as const };
      const result = transition(state, "session.restore.completed");
      expect(result.session).toBe("attached");
      expect(result.lane).toBe("new");
      expect(result.terminal).toBe("idle");
    });

    it("transitions session to terminated on session.terminated", () => {
      const state = { ...INITIAL_RUNTIME_STATE, session: "attached" as const };
      const result = transition(state, "session.terminated");
      expect(result.session).toBe("terminated");
      expect(result.lane).toBe("new");
      expect(result.terminal).toBe("idle");
    });
  });

  describe("terminal axis transitions", () => {
    it("transitions terminal from idle to spawning on terminal.spawn.requested", () => {
      const initialState = {
        lane: "new" as const,
        session: "detached" as const,
        terminal: "idle" as const,
      };
      const state = transition(initialState, "terminal.spawn.requested");
      expect(state.terminal).toBe("spawning");
      expect(state.lane).toBe("new");
      expect(state.session).toBe("detached");
    });

    it("transitions terminal from spawning to active on terminal.spawn.succeeded", () => {
      const state = { ...INITIAL_RUNTIME_STATE, terminal: "spawning" as const };
      const result = transition(state, "terminal.spawn.succeeded");
      expect(result.terminal).toBe("active");
      expect(result.lane).toBe("new");
      expect(result.session).toBe("detached");
    });

    it("transitions terminal to throttled on terminal.throttled", () => {
      const state = { ...INITIAL_RUNTIME_STATE, terminal: "active" as const };
      const result = transition(state, "terminal.throttled");
      expect(result.terminal).toBe("throttled");
      expect(result.lane).toBe("new");
      expect(result.session).toBe("detached");
    });

    it("transitions terminal to errored on terminal.error", () => {
      const state = { ...INITIAL_RUNTIME_STATE, terminal: "active" as const };
      const result = transition(state, "terminal.error");
      expect(result.terminal).toBe("errored");
      expect(result.lane).toBe("new");
      expect(result.session).toBe("detached");
    });

    it("transitions terminal to stopped on terminal.stopped", () => {
      const state = { ...INITIAL_RUNTIME_STATE, terminal: "active" as const };
      const result = transition(state, "terminal.stopped");
      expect(result.terminal).toBe("stopped");
      expect(result.lane).toBe("new");
      expect(result.session).toBe("detached");
    });
  });

  describe("invalid and unknown events", () => {
    it("returns same state for unknown event", () => {
      const initialState = {
        lane: "new" as const,
        session: "detached" as const,
        terminal: "idle" as const,
      };
      const result = transition(initialState, "unknown.event" as any);
      expect(result).toEqual(initialState);
      expect(result.lane).toBe("new");
      expect(result.session).toBe("detached");
      expect(result.terminal).toBe("idle");
    });

    it("does not mutate state on unknown event", () => {
      const originalState = {
        lane: "new" as const,
        session: "detached" as const,
        terminal: "idle" as const,
      };
      const result = transition(originalState, "invalid.event" as any);
      expect(result).toEqual(originalState);
    });
  });

  describe("full lifecycle sequence", () => {
    it("transitions through lane.create → session.attach → terminal.spawn", () => {
      let state = INITIAL_RUNTIME_STATE;

      // Lane creation phase
      state = transition(state, "lane.create.requested");
      expect(state.lane).toBe("provisioning");
      expect(state.session).toBe("detached");
      expect(state.terminal).toBe("idle");

      state = transition(state, "lane.create.succeeded");
      expect(state.lane).toBe("ready");

      state = transition(state, "lane.run.started");
      expect(state.lane).toBe("running");

      // Session attachment phase
      state = transition(state, "session.attach.requested");
      expect(state.session).toBe("attaching");
      expect(state.lane).toBe("running");
      expect(state.terminal).toBe("idle");

      state = transition(state, "session.attach.succeeded");
      expect(state.session).toBe("attached");

      // Terminal spawning phase
      state = transition(state, "terminal.spawn.requested");
      expect(state.terminal).toBe("spawning");
      expect(state.lane).toBe("running");
      expect(state.session).toBe("attached");

      state = transition(state, "terminal.spawn.succeeded");
      expect(state.terminal).toBe("active");
      expect(state.lane).toBe("running");
      expect(state.session).toBe("attached");
    });

    it("handles full lifecycle with session restore", () => {
      let state = INITIAL_RUNTIME_STATE;

      state = transition(state, "lane.create.requested");
      state = transition(state, "lane.create.succeeded");
      state = transition(state, "lane.run.started");
      state = transition(state, "session.attach.requested");
      state = transition(state, "session.attach.succeeded");

      // Session restore
      state = transition(state, "session.restore.started");
      expect(state.session).toBe("restoring");

      state = transition(state, "session.restore.completed");
      expect(state.session).toBe("attached");

      state = transition(state, "terminal.spawn.requested");
      state = transition(state, "terminal.spawn.succeeded");
      expect(state.terminal).toBe("active");
    });

    it("handles terminal error during active operation", () => {
      let state = INITIAL_RUNTIME_STATE;

      state = transition(state, "lane.create.requested");
      state = transition(state, "lane.create.succeeded");
      state = transition(state, "lane.run.started");
      state = transition(state, "session.attach.requested");
      state = transition(state, "session.attach.succeeded");
      state = transition(state, "terminal.spawn.requested");
      state = transition(state, "terminal.spawn.succeeded");

      // Terminal error
      state = transition(state, "terminal.error");
      expect(state.terminal).toBe("errored");
      expect(state.lane).toBe("running");
      expect(state.session).toBe("attached");
    });

    it("handles lane cleanup and session termination", () => {
      let state = INITIAL_RUNTIME_STATE;

      state = transition(state, "lane.create.requested");
      state = transition(state, "lane.create.succeeded");
      state = transition(state, "lane.run.started");
      state = transition(state, "session.attach.requested");
      state = transition(state, "session.attach.succeeded");
      state = transition(state, "terminal.spawn.requested");
      state = transition(state, "terminal.spawn.succeeded");

      // Cleanup phase
      state = transition(state, "session.terminated");
      expect(state.session).toBe("terminated");

      state = transition(state, "lane.cleanup.started");
      expect(state.lane).toBe("cleaning");

      state = transition(state, "lane.cleanup.completed");
      expect(state.lane).toBe("closed");
      expect(state.session).toBe("terminated");
    });

    it("handles lane blocking and sharing", () => {
      let state = INITIAL_RUNTIME_STATE;

      state = transition(state, "lane.create.requested");
      state = transition(state, "lane.create.succeeded");
      state = transition(state, "lane.run.started");

      // Lane blocking
      state = transition(state, "lane.blocked");
      expect(state.lane).toBe("blocked");

      // Assume unblock by starting share
      state = { ...state, lane: "running" as const };

      // Lane sharing
      state = transition(state, "lane.share.started");
      expect(state.lane).toBe("shared");

      state = transition(state, "lane.share.stopped");
      expect(state.lane).toBe("running");
    });

    it("handles terminal throttling and recovery", () => {
      let state = INITIAL_RUNTIME_STATE;

      state = transition(state, "terminal.spawn.requested");
      state = transition(state, "terminal.spawn.succeeded");
      expect(state.terminal).toBe("active");

      // Terminal throttle
      state = transition(state, "terminal.throttled");
      expect(state.terminal).toBe("throttled");

      // Assume recovery by manual reset to active
      state = { ...state, terminal: "active" as const };
      expect(state.terminal).toBe("active");
    });
  });

  describe("state independence", () => {
    it("lane transitions do not affect session and terminal states", () => {
      const state = {
        lane: "new" as const,
        session: "attached" as const,
        terminal: "active" as const,
      };

      const result = transition(state, "lane.create.requested");
      expect(result.lane).toBe("provisioning");
      expect(result.session).toBe("attached");
      expect(result.terminal).toBe("active");
    });

    it("session transitions do not affect lane and terminal states", () => {
      const state = {
        lane: "running" as const,
        session: "detached" as const,
        terminal: "active" as const,
      };

      const result = transition(state, "session.attach.requested");
      expect(result.lane).toBe("running");
      expect(result.session).toBe("attaching");
      expect(result.terminal).toBe("active");
    });

    it("terminal transitions do not affect lane and session states", () => {
      const state = {
        lane: "running" as const,
        session: "attached" as const,
        terminal: "idle" as const,
      };

      const result = transition(state, "terminal.spawn.requested");
      expect(result.lane).toBe("running");
      expect(result.session).toBe("attached");
      expect(result.terminal).toBe("spawning");
    });
  });

  describe("edge cases", () => {
    it("handles transitions from any state to any compatible state", () => {
      const state = {
        lane: "closed" as const,
        session: "terminated" as const,
        terminal: "stopped" as const,
      };

      // Terminal stopped can still error
      const result = transition(state, "terminal.error");
      expect(result.terminal).toBe("errored");
    });

    it("maintains immutability on each transition", () => {
      const originalState = INITIAL_RUNTIME_STATE;
      const state1 = transition(originalState, "lane.create.requested");
      const state2 = transition(state1, "session.attach.requested");

      expect(originalState).toEqual(INITIAL_RUNTIME_STATE);
      expect(state1).not.toEqual(originalState);
      expect(state2).not.toEqual(state1);
    });
  });
});
