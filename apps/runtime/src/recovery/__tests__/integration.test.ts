
import { RecoveryStateMachine, RecoveryStage } from "../state-machine.js";

import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

describe("Integration Tests - Crash to Live Recovery", () => {
  let tempDir: string;
  let bus: InMemoryLocalBus;
  let pipeline: RestorationPipeline;
  let stateMachine: RecoveryStateMachine;

  const createMockSession = (index: number): CheckpointSession => ({
    sessionId: `sess-${index}`,
    terminalId: `term-${index}`,
    laneId: `lane-${index}`,
    workingDirectory: tempDir,
    environmentVariables: { TEST: "true" },
    scrollbackSnapshot: `output ${index}`,
    zelijjSessionName: `session-${index}`,
    shellCommand: "bash",
  });

  const createMockCheckpoint = (sessionCount: number): Checkpoint => ({
    version: 1,
    timestamp: Date.now(),
    checksum: "",
    sessions: Array.from({ length: sessionCount }, (_, i) => createMockSession(i)),
  });

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `integration-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    bus = new InMemoryLocalBus();
    pipeline = new RestorationPipeline(bus);
    stateMachine = new RecoveryStateMachine(tempDir, bus);
    await stateMachine.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("Full recovery (SC-027-001)", () => {
    it("should restore all sessions with valid checkpoint", async () => {
      const _checkpoint = createMockCheckpoint(5);

      // Simulate crash detection and state progression
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);

      // Run restoration
      const result = await pipeline.restore(checkpoint);

      expect(result.restored.length).toBe(5);
      expect(result.failed.length).toBe(0);
      expect(result.duration).toBeLessThan(10000); // < 10s
    });

    it("should progress state machine through all stages", async () => {
      const stages: RecoveryStage[] = [];
      stateMachine.onStageChange((_, to) => {
        stages.push(to);
      });

      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);
      const _checkpoint = createMockCheckpoint(5);
      await pipeline.restore(checkpoint);
      await stateMachine.transition(RecoveryStage.RECONCILING);
      await stateMachine.transition(RecoveryStage.LIVE);

      expect(stages).toContain(RecoveryStage.DETECTING);
      expect(stages).toContain(RecoveryStage.INVENTORYING);
      expect(stages).toContain(RecoveryStage.RESTORING);
      expect(stages).toContain(RecoveryStage.RECONCILING);
      expect(stages).toContain(RecoveryStage.LIVE);
    });
  });

  describe("Partial recovery (SC-027-003)", () => {
    it("should report failed sessions with reasons", async () => {
      const _checkpoint = createMockCheckpoint(5);
      // Simulate corrupted checkpoint for session 2
      checkpoint.sessions[2].workingDirectory = "/nonexistent/path";

      const result = await pipeline.restore(checkpoint);

      expect(result.restored.length).toBe(4);
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].sessionId).toBe("sess-2");
      expect(result.failed[0].reason).toBeTruthy();
    });

    it("should include suggestions for failed sessions", async () => {
      const _checkpoint = createMockCheckpoint(3);
      checkpoint.sessions[1].workingDirectory = "/nonexistent";

      const result = await pipeline.restore(checkpoint);

      const failed = result.failed.find(f => f.sessionId === "sess-1");
      expect(failed).toBeDefined();
      expect(failed?.suggestion).toBeTruthy();
    });
  });

  describe("Crash during recovery resume", () => {
    it("should resume from persisted stage after simulated crash", async () => {
      // First recovery attempt - progress to RESTORING
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);

      // Get current stage
      const _checkpoint = createMockCheckpoint(5);
      const beforeCrash = stateMachine.getCurrentStage();

      // Simulate second recovery after crash - should resume from RESTORING
      const stateMachine2 = new RecoveryStateMachine(tempDir, bus);
      const resumedStage = await stateMachine2.resume();

      expect(resumedStage).toBe(beforeCrash);
      expect(resumedStage).toBe(RecoveryStage.RESTORING);
    });

    it("should not re-restore previously restored sessions", async () => {
      const _checkpoint = createMockCheckpoint(3);

      // First restoration
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);

      const result1 = await pipeline.restore(checkpoint);
      const restoredIds = new Set(result1.restored.map(s => s.sessionId));

      // Simulate second restoration
      const result2 = await pipeline.restore(checkpoint);

      // Both should have same number of restored sessions
      expect(result2.restored.length).toBe(result1.restored.length);
      result2.restored.forEach(s => {
        expect(restoredIds.has(s.sessionId)).toBe(true);
      });
    });
  });

  describe("Zellij reattach vs respawn", () => {
    it("should attempt zellij reattach for surviving sessions", async () => {
      const _checkpoint = createMockCheckpoint(2);

      const result = await pipeline.restore(checkpoint);

      // Some sessions should be marked as respawned (since no zellij sessions in test)
      const respawned = result.restored.filter(s => s.status === "respawned");
      expect(respawned.length).toBeGreaterThan(0);
    });

    it("should fall back to respawn if reattach fails", async () => {
      const _checkpoint = createMockCheckpoint(1);

      const result = await pipeline.restore(checkpoint);

      expect(result.restored.length).toBe(1);
      expect(result.restored[0].status).toBe("respawned");
    });
  });

  describe("Missing working directory handling", () => {
    it("should mark session as failed when working directory missing", async () => {
      const _checkpoint = createMockCheckpoint(1);
      checkpoint.sessions[0].workingDirectory = "/nonexistent/directory/path";

      const result = await pipeline.restore(checkpoint);

      expect(result.failed.length).toBe(1);
      expect(result.failed[0].reason).toContain("ENOENT");
      expect(result.failed[0].suggestion).toContain("no longer exists");
    });
  });

  describe("Bus event publishing", () => {
    it("should publish session restored events", async () => {
      const _checkpoint = createMockCheckpoint(1);

      await pipeline.restore(checkpoint);

      const events = bus.getEvents();
      const restoredEvent = events.find(e => e.topic === "recovery.session.restored");
      expect(restoredEvent).toBeDefined();
    });

    it("should publish session failed events", async () => {
      const _checkpoint = createMockCheckpoint(1);
      checkpoint.sessions[0].workingDirectory = "/nonexistent";

      await pipeline.restore(checkpoint);

      const events = bus.getEvents();
      const failedEvent = events.find(e => e.topic === "recovery.session.failed");
      expect(failedEvent).toBeDefined();
    });

    it("should publish stage change events", async () => {
      await stateMachine.transition(RecoveryStage.DETECTING);

      const events = bus.getEvents();
      const stageEvent = events.find(e => e.topic === "recovery.stage.changed");
      expect(stageEvent).toBeDefined();
      expect(stageEvent?.payload?.current).toBe(RecoveryStage.DETECTING);
    });
  });

  describe("Performance (SC-027-002)", () => {
    it("should restore 25 sessions within 10 seconds", async () => {
      const _checkpoint = createMockCheckpoint(25);

      const _startTime = Date.now();
      const result = await pipeline.restore(checkpoint);
      const _duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10000);
      expect(result.restored.length).toBe(25);
    });
  });
});
