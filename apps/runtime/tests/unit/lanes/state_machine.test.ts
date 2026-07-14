// T017 - Unit tests for lane state machine (FR-008-001, NFR-008-004)
// Traces to: FR-LAN-001 (lane state machine: new -> provisioning -> ready -> running -> blocked -> shared -> cleaning -> closed)

import { describe, expect, it, beforeEach } from "bun:test";
import {
  transition,
  withLaneLock,
  recordTransition,
  getTransitionHistory,
  clearTransitionHistory,
  InvalidLaneTransitionError,
  type LaneState,
  type LaneEvent,
} from "../../../src/lanes/state_machine.js";

describe("Lane State Machine (FR-008-001)", () => {
  describe("valid transitions", () => {
    const validCases: Array<[LaneState, LaneEvent, LaneState]> = [
      ["new", "create", "provisioning"],
      ["provisioning", "provision_complete", "ready"],
      ["provisioning", "provision_failed", "closed"],
      ["ready", "start_running", "running"],
      ["ready", "share", "shared"],
      ["ready", "request_cleanup", "cleaning"],
      ["running", "command_complete", "ready"],
      ["running", "block", "blocked"],
      ["running", "request_cleanup", "cleaning"],
      ["blocked", "unblock", "running"],
      ["blocked", "request_cleanup", "cleaning"],
      ["shared", "unshare", "ready"],
      ["shared", "request_cleanup", "cleaning"],
      ["cleaning", "cleanup_complete", "closed"],
      ["cleaning", "request_cleanup", "cleaning"],
    ];

    for (const [from, event, to] of validCases) {
      it(`${from} + ${event} -> ${to}`, () => {
        expect(transition(from, event, "test-lane")).toBe(to);
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidCases: Array<[LaneState, LaneEvent]> = [
      ["closed", "create"],
      ["closed", "provision_complete"],
      ["closed", "start_running"],
      ["closed", "request_cleanup"],
      ["new", "provision_complete"],
      ["new", "start_running"],
      ["new", "request_cleanup"],
      ["provisioning", "start_running"],
      ["provisioning", "share"],
      ["ready", "provision_complete"],
      ["ready", "unblock"],
      ["running", "create"],
      ["running", "share"],
      ["blocked", "share"],
      ["shared", "start_running"],
      ["cleaning", "start_running"],
    ];

    for (const [from, event] of invalidCases) {
      it(`rejects ${from} + ${event}`, () => {
        expect(() => transition(from, event, "lane-1")).toThrow(InvalidLaneTransitionError);
      });
    }

    it("error includes lane ID, state, and event", () => {
      try {
        transition("closed", "create", "lane-42");
        expect(true).toBe(false);
      } catch (e) {
        const err = e as InvalidLaneTransitionError;
        expect(err).toBeInstanceOf(InvalidLaneTransitionError);
        expect(err.laneId).toBe("lane-42");
        expect(err.currentState).toBe("closed");
        expect(err.attemptedEvent).toBe("create");
      }
    });
  });

  describe("per-lane mutex (NFR-008-004)", () => {
    it("serializes operations on the same lane", async () => {
      const order: number[] = [];

      const p1 = withLaneLock("lane-ser", async () => {
        await new Promise(r => setTimeout(r, 50));
        order.push(1);
      });

      const p2 = withLaneLock("lane-ser", async () => {
        order.push(2);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]);
    });

    it("allows concurrent operations on different lanes", async () => {
      const order: string[] = [];

      const p1 = withLaneLock("lane-cx", async () => {
        await new Promise(r => setTimeout(r, 50));
        order.push("x");
      });

      const p2 = withLaneLock("lane-cy", async () => {
        order.push("y");
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual(["y", "x"]);
    });

    it("propagates errors and releases lock", async () => {
      let secondRan = false;
      try {
        await withLaneLock("lane-err", async () => {
          throw new Error("boom");
        });
    // eslint-disable-next-line no-unused-vars
      } catch (_err) {
        // expected
      }
      await withLaneLock("lane-err", async () => {
        secondRan = true;
      });
      expect(secondRan).toBe(true);
    });

    it("serializes three sequential operations", async () => {
      const order: number[] = [];
      const p1 = withLaneLock("lane-3seq", async () => {
        await new Promise(r => setTimeout(r, 30));
        order.push(1);
      });
      const p2 = withLaneLock("lane-3seq", async () => {
        await new Promise(r => setTimeout(r, 10));
        order.push(2);
      });
      const p3 = withLaneLock("lane-3seq", async () => {
        order.push(3);
      });
      await Promise.all([p1, p2, p3]);
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("transition history", () => {
    const laneId = "hist-unit-lane";

    beforeEach(() => {
      clearTransitionHistory(laneId);
    });

    it("records transitions in order", () => {
      recordTransition(laneId, "new", "create", "provisioning");
      recordTransition(laneId, "provisioning", "provision_complete", "ready");
      recordTransition(laneId, "ready", "start_running", "running");

      const history = getTransitionHistory(laneId);
      expect(history.length).toBe(3);
      expect(history[0]!.fromState).toBe("new");
      expect(history[0]!.toState).toBe("provisioning");
      expect(history[2]!.fromState).toBe("ready");
      expect(history[2]!.toState).toBe("running");
    });

    it("includes timestamps", () => {
      recordTransition(laneId, "new", "create", "provisioning");
      const history = getTransitionHistory(laneId);
      expect(history[0]!.timestamp).toBeTruthy();
      expect(new Date(history[0]!.timestamp).getTime()).toBeGreaterThan(0);
    });

    it("caps at 20 entries", () => {
      for (let i = 0; i < 25; i++) {
        recordTransition(laneId, "ready", "start_running", "running");
      }
      expect(getTransitionHistory(laneId).length).toBe(20);
    });

    it("returns empty array for unknown lane", () => {
      expect(getTransitionHistory("unknown-lane")).toEqual([]);
    });

    it("clear removes all history", () => {
      recordTransition(laneId, "new", "create", "provisioning");
      clearTransitionHistory(laneId);
      expect(getTransitionHistory(laneId).length).toBe(0);
    });
  });
});
