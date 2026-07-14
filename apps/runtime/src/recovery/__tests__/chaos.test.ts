import { RestorationPipeline } from "../restoration.js";
import { RecoveryStateMachine, RecoveryStage } from "../state-machine.js";
import { CrashLoopDetector, SafeMode } from "../safe-mode.js";
import { CheckpointWriter, CheckpointReader, type Checkpoint } from "../checkpoint.js";
import { OrphanReconciler } from "../orphan-reconciler.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

describe("Chaos Tests - Crash Recovery Resilience", () => {
  let tempDir: string;
  let bus: InMemoryLocalBus;

  const createMockCheckpoint = (sessionCount: number): Checkpoint => ({
    version: 1,
    timestamp: Date.now(),
    checksum: "",
    sessions: Array.from({ length: sessionCount }, (_, i) => ({
      sessionId: `sess-${i}`,
      terminalId: `term-${i}`,
      laneId: `lane-${i}`,
      workingDirectory: tempDir,
      environmentVariables: {},
      scrollbackSnapshot: `test ${i}`,
      zelijjSessionName: `session-${i}`,
      shellCommand: "bash",
    })),
  });

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `chaos-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    // Pre-create recovery subdirectory to avoid race conditions
    await fs.mkdir(path.join(tempDir, "recovery"), { recursive: true });
    bus = new InMemoryLocalBus();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("Crash during checkpoint write", () => {
    it("should recover using previous checkpoint after write crash", async () => {
      const writer = new CheckpointWriter(tempDir);
      const reader = new CheckpointReader(tempDir);

      const checkpoint1 = createMockCheckpoint(3);
      await writer.write(checkpoint1);

      // Simulate crash during second write (temp file left, no rename)
      const checkpoint2 = createMockCheckpoint(4);
      const checkpointPath = writer.getCheckpointPath();
      const tempPath = `${checkpointPath}.tmp`;

      await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(checkpoint2));
      // Don't rename - simulate crash

      // Reader should recover checkpoint1
      const recovered = await reader.read();
      expect(recovered).not.toBeNull();
      expect(recovered?.sessions.length).toBe(3);
    });

    it("should clean up stale temp files on next write", async () => {
      const writer = new CheckpointWriter(tempDir);

      const _checkpoint = createMockCheckpoint(2);
      await writer.write(checkpoint);

      const tempPath = `${writer.getCheckpointPath()}.tmp`;
      const tempExists = await fs
        .access(tempPath)
        .then(() => true)
        .catch(() => false);
      expect(tempExists).toBe(false);
    });
  });

  describe("Crash loop detection (SC-027-004)", () => {
    it("should detect crash loop and enter safe mode within 5 seconds", async () => {
      vi.useFakeTimers();

      const detector = new CrashLoopDetector(tempDir, 3, 60000);
      await detector.initialize();

      const safeMode = new SafeMode(bus);

      const now = Date.now();
      const crashes = [now, now + 1000, now + 2000];

      for (const crashTime of crashes) {
        detector.recordCrash(crashTime);
        if (detector.isLooping()) {
          await safeMode.enter();
          break;
        }
      }

      expect(safeMode.isActive()).toBe(true);

      vi.useRealTimers();
    });

    it("should disable non-essential subsystems in safe mode", async () => {
      const safeMode = new SafeMode(bus, {
        disableProviders: true,
        disableShareSessions: true,
        disableBackgroundCheckpoints: true,
      });

      await safeMode.enter();

      expect(safeMode.isProvidersEnabled()).toBe(false);
      expect(safeMode.isShareSessionsEnabled()).toBe(false);
      expect(safeMode.isBackgroundCheckpointsEnabled()).toBe(false);
    });
  });

  describe("Orphan reconciliation (SC-027-005)", () => {
    it("should clean safe-to-terminate orphans", async () => {
      const reconciler = new OrphanReconciler(["sess-1"], bus);

      const report = await reconciler.scan();

      // Even with no real orphans, cleanup should succeed
      const result = await reconciler.cleanup(report);

      expect(result).toBeDefined();
      expect(result.terminated + result.removed).toBeLessThanOrEqual(report.safeToTerminate.length);
    });

    it("should flag needs-review orphans without terminating them", async () => {
      const reconciler = new OrphanReconciler(["sess-1"], bus);
      const report = await reconciler.scan();

      const result = await reconciler.cleanup(report);

      expect(result.reviewPending).toBe(report.needsReview.length);
    });

    it("should publish cleanup event to bus", async () => {
      const reconciler = new OrphanReconciler(["sess-1"], bus);
      const report = await reconciler.scan();

      await reconciler.cleanup(report);

      const events = bus.getEvents();
      const cleanupEvent = events.find(e => e.topic === "recovery.orphans.cleaned");
      expect(cleanupEvent).toBeDefined();
    });
  });

  describe("Full recovery cycle resilience", () => {
    it("should complete full recovery cycle within SLO", async () => {
      const _checkpoint = createMockCheckpoint(5);
      const pipeline = new RestorationPipeline(bus);
      const stateMachine = new RecoveryStateMachine(tempDir, bus);
      await stateMachine.initialize();

      const _startTime = Date.now();

      // Full cycle
      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.INVENTORYING);
      await stateMachine.transition(RecoveryStage.RESTORING);

      const result = await pipeline.restore(checkpoint);

      const reconciler = new OrphanReconciler(
        result.restored.map(s => s.sessionId),
        bus
      );
      const report = await reconciler.scan();
      await reconciler.cleanup(report);

      await stateMachine.transition(RecoveryStage.RECONCILING);
      await stateMachine.transition(RecoveryStage.LIVE);

      const totalDuration = Date.now() - startTime;

      expect(totalDuration).toBeLessThan(10000); // < 10s SLO
      expect(result.restored.length).toBeGreaterThan(0);
    });
  });

  describe("Concurrent operations during recovery", () => {
    it("should handle concurrent activity during recovery", async () => {
      const _checkpoint = createMockCheckpoint(3);
      const pipeline = new RestorationPipeline(bus);
      const stateMachine = new RecoveryStateMachine(tempDir, bus);
      await stateMachine.initialize();

      await stateMachine.transition(RecoveryStage.DETECTING);

      // Simulate concurrent activity
      const activityPromises = [];
      for (let i = 0; i < 5; i++) {
        activityPromises.push(
          new Promise(resolve => {
            setTimeout(async () => {
              // Simulate user activity
              resolve(undefined);
            }, Math.random() * 1000);
          })
        );
      }

      await stateMachine.transition(RecoveryStage.INVENTORYING);
      const result = await Promise.all([pipeline.restore(checkpoint), ...activityPromises]);

      expect(result[0].restored.length).toBeGreaterThan(0);
    });
  });

  describe("Repeated chaos scenarios", () => {
    it("should maintain consistency across 5 recovery cycles", async () => {
      const _results = [];

      for (let i = 0; i < 5; i++) {
        const _checkpoint = createMockCheckpoint(3);
        const pipeline = new RestorationPipeline(bus);

        const result = await pipeline.restore(checkpoint);
        results.push(result);

        expect(result.restored.length).toBe(3);
        expect(result.failed.length).toBe(0);
      }

      // All cycles should have consistent results
      expect(results.every(r => r.restored.length === 3)).toBe(true);
      expect(results.every(r => r.failed.length === 0)).toBe(true);
    });
  });

  describe("State machine resilience", () => {
    it("should recover from failure state and retry", async () => {
      const stateMachine = new RecoveryStateMachine(tempDir, bus);
      await stateMachine.initialize();

      await stateMachine.transition(RecoveryStage.DETECTING);
      await stateMachine.transition(RecoveryStage.DETECTION_FAILED);

      // Should be able to retry
      await stateMachine.transition(RecoveryStage.DETECTING);
      expect(stateMachine.getCurrentStage()).toBe(RecoveryStage.DETECTING);
    });

    it("should enforce max retry limit", async () => {
      const stateMachine = new RecoveryStateMachine(tempDir, bus);
      await stateMachine.initialize();

      // Attempt DETECTING -> DETECTION_FAILED cycle multiple times (MAX_RETRIES_PER_STAGE = 3)
      // Each cycle increments attemptCount for the source stage (DETECTING)
      for (let i = 0; i < 3; i++) {
        await stateMachine.transition(RecoveryStage.DETECTING);
        await stateMachine.transition(RecoveryStage.DETECTION_FAILED);
      }

      // Fourth attempt to DETECTING from DETECTION_FAILED should fail due to max retries
      await expect(stateMachine.transition(RecoveryStage.DETECTING)).rejects.toThrow("Max retries");
    });
  });
});
