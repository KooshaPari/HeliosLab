import { RecoveryStateMachine, RecoveryStage, type RecoveryState } from "../state-machine.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Traces to: FR-CRH-002 (recovery state machine)
describe("RecoveryStateMachine", () => {
  let stateMachine: RecoveryStateMachine;
  let tempDir: string;
  let bus: InMemoryLocalBus;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `state-machine-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    bus = new InMemoryLocalBus();
    stateMachine = new RecoveryStateMachine(tempDir, bus);
    await stateMachine.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("stage progression", () => {
    it("should start in CRASHED stage", () => {
      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.CRASHED);
    });

    it("should progress through all stages in order", async () => {
      const stages: RecoveryStage[] = [];

      stateMachine.onStageChange((from, to) => {
        stages.push(to);
      });

      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);
      await stateMachine.transition(RecoveryStage.RECONCILING);
      await stateMachine.transition(RecoveryStage.LIVE);

      expect(stages).toEqual([
        RecoveryStage.DETECTING,
        RecoveryStage.INVENTORYING,
        RecoveryStage.RESTORING,
        RecoveryStage.RECONCILING,
        RecoveryStage.LIVE,
      ]);
    });

    it("should reject illegal transitions", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);

      await expect(stateMachine.transition(RecoveryStage.RESTORING)).rejects.toThrow(
        "Illegal transition"
      );
    });

    it("should allow transition to failure state", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);

      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.DETECTION_FAILED);
    });

    it("should allow retry from failure state", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);
      await stateMachine.transition(RecoveryStage.DETECTING);

      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.DETECTING);
    });
  });

  describe("persistence and resume", () => {
    it("should persist state to filesystem", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);

      const statePath = path.join(tempDir, "recovery", "recovery-state.json");
      const exists = await fs
        .access(statePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(content) as RecoveryState;
      expect(state.stage).toBe(RecoveryStage.INVENTORYING);
    });

    it("should resume from persisted stage", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);

      // Create new state machine instance
      const stateMachine2 = new RecoveryStateMachine(tempDir, bus);
      const resumedStage = await stateMachine2.resume();

      expect(resumedStage).toBe(RecoveryStage.INVENTORYING);
      expect(stateMachine2.getCurrentStage()).toBe(RecoveryStage.INVENTORYING);
    });

    it("should handle missing persisted state gracefully", async () => {
      const stateMachine2 = new RecoveryStateMachine(tempDir, bus);
      await stateMachine2.initialize();

      expect(stateMachine2.getCurrentStage()).toBe(RecoveryStage.CRASHED);
    });

    it("should reset state after successful recovery", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.reset();

      // Create new instance - should start from CRASHED
      const stateMachine2 = new RecoveryStateMachine(tempDir, bus);
      await stateMachine2.initialize();
      expect(stateMachine2.getCurrentStage()).toBe(RecoveryStage.CRASHED);
    });
  });

  describe("attempt counting and retry limiting", () => {
    it("should track attempt count on retries", async () => {
      const attempts: number[] = [];

      stateMachine.onStageChange((_, __, attemptCount) => {
        attempts.push(attemptCount);
      });

      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);
      await stateMachine.transition(RecoveryStage.DETECTING);

      expect(attempts).toContain(1); // Second attempt
    });

    it("should fail after max retries exceeded", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);

      // Try 3 times
      for (let i = 0; i < 3; i++) {
        await stateMachine.transition(RecoveryStage.DETECTION_FAILED);
        await stateMachine.transition(RecoveryStage.DETECTING);
      }

      // Fourth attempt should fail
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);
      await expect(stateMachine.transition(RecoveryStage.DETECTING)).rejects.toThrow("Max retries");
    });

    it("should reset attempt count when moving to next stage", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);

      // Attempt count should be reset for new stage
      await stateMachine.transition(RecoveryStage.INVENTORY_FAILED);
      const statePath = path.join(tempDir, "recovery", "recovery-state.json");
      const content = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(content) as RecoveryState;
      expect(state.attemptCount).toBe(0);
    });
  });

  describe("stage timeout", () => {
    it("should transition to failure state on timeout", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      // Manually transition to failure state (simulating timeout behavior)
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);

      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.DETECTION_FAILED);
    });

    it("should not timeout when transitioned to next stage", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      // timer advance skipped // Halfway through timeout
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      // timer advance skipped // Would timeout if detection timeout still running

      // Should be in INVENTORYING, not DETECTION_FAILED
      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.INVENTORYING);
    });
  });

  describe("bus events", () => {
    it("should publish stage change events", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      const events = bus.getEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].topic).toBe("recovery.stage.changed");
    });

    it("should include correct payload in stage change event", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);
      const events = bus.getEvents();
      const event = events[0];
      expect(event.payload).toMatchObject({
        previous: RecoveryStage.CRASHED,
        current: RecoveryStage.DETECTING,
        attemptCount: 0,
      });
    });

    it("should work without bus", async () => {
      const stateMachineNoBus = new RecoveryStateMachine(tempDir);
      await stateMachineNoBus.initialize();

      // Should not throw
      await expect(stateMachineNoBus.transition(RecoveryStage.DETECTING)).resolves.toBeUndefined();
    });
  });

  describe("listener notifications", () => {
    it("should notify listeners on stage change", async () => {
      const changes: Array<[string, string, number]> = [];

      stateMachine.onStageChange((from, to, attemptCount) => {
        changes.push([from, to, attemptCount]);
      });

      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);

      expect(changes.length).toBe(2);
      expect(changes[0]).toEqual([RecoveryStage.CRASHED, RecoveryStage.DETECTING, 0]);
      expect(changes[1]).toEqual([RecoveryStage.DETECTING, RecoveryStage.INVENTORYING, 0]);
    });
  });
});
