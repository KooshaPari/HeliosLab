/**
 * FR-HELIOS-097: Lane State Machine Unit Tests
 * Verifies: FR-LAN-001 (Lane state transitions)
 */
import { describe, expect, it } from "bun:test";
import {
  transition,
  withLaneLock,
  recordTransition,
  getTransitionHistory,
  clearTransitionHistory,
  InvalidLaneTransitionError,
  type LaneState,
  type LaneEvent,
} from "../../src/lanes/state_machine.js";

describe("Lane State Machine", () => {
  describe("valid transitions", () => {
    const cases: Array<[LaneState, LaneEvent, LaneState]> = [
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
      ["cleaning", "request_cleanup", "cleaning"], // idempotent
    ];

    for (const [from, event, to] of cases) {
      it(`${from} + ${event} -> ${to}`, () => {
        expect(transition(from, event, "test-lane")).toBe(to);
      });
    }
  });

  describe("invalid transitions", () => {
    it("throws for closed state (terminal)", () => {
      expect(() => transition("closed", "create", "lane-1")).toThrow(InvalidLaneTransitionError);
    });

    it("throws for new + provision_complete", () => {
      expect(() => transition("new", "provision_complete", "lane-1")).toThrow(
        InvalidLaneTransitionError
      );
    });

    it("error includes lane ID, state, and event", () => {
      try {
        transition("closed", "create", "lane-42");
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidLaneTransitionError);
        const err = e as InvalidLaneTransitionError;
        expect(err.laneId).toBe("lane-42");
        expect(err.currentState).toBe("closed");
        expect(err.attemptedEvent).toBe("create");
      }
    });
  });

  describe("per-lane mutex", () => {
    it("serializes operations on the same lane", async () => {
      const order: number[] = [];

      const p1 = withLaneLock("lane-a", async () => {
        await new Promise(r => setTimeout(r, 50));
        order.push(1);
      });

      const p2 = withLaneLock("lane-a", async () => {
        order.push(2);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]);
    });

    it("allows concurrent operations on different lanes", async () => {
      const order: string[] = [];

      const p1 = withLaneLock("lane-x", async () => {
        await new Promise(r => setTimeout(r, 50));
        order.push("x");
      });

      const p2 = withLaneLock("lane-y", async () => {
        order.push("y");
      });

      await Promise.all([p1, p2]);
      // y should complete before x since they run independently
      expect(order).toEqual(["y", "x"]);
    });
  });

  describe("transition history", () => {
    it("records and retrieves transitions", () => {
      const laneId = "history-test-lane";
      clearTransitionHistory(laneId);

      recordTransition(laneId, "new", "create", "provisioning");
      recordTransition(laneId, "provisioning", "provision_complete", "ready");

      const history = getTransitionHistory(laneId);
      expect(history.length).toBe(2);
      expect(history[0]!.fromState).toBe("new");
      expect(history[0]!.toState).toBe("provisioning");
      expect(history[1]!.fromState).toBe("provisioning");
      expect(history[1]!.toState).toBe("ready");

      clearTransitionHistory(laneId);
    });

    it("caps at 20 entries", () => {
      const laneId = "cap-test-lane";
      clearTransitionHistory(laneId);

      for (let i = 0; i < 25; i++) {
        recordTransition(laneId, "ready", "start_running", "running");
      }

      const history = getTransitionHistory(laneId);
      expect(history.length).toBe(20);

      clearTransitionHistory(laneId);
    });
  });
});
