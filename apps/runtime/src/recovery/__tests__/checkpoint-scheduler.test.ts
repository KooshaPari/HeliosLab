import { CheckpointScheduler } from "../checkpoint-scheduler.js";

import { promises as fs } from "fs";
import path from "path";
import os from "os";

describe("CheckpointScheduler", () => {
  let scheduler: CheckpointScheduler;
  let writer: CheckpointWriter;
  let tempDir: string;
  let writeCount = 0;

  const createMockCheckpoint = (): Checkpoint => ({
    version: 1,
    timestamp: Date.now(),
    checksum: "",
    sessions: [
      {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      },
    ],
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `scheduler-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    // Pre-create recovery subdirectory to avoid race conditions
    await fs.mkdir(path.join(tempDir, "recovery"), { recursive: true });
    scheduler = new CheckpointScheduler();
    writer = new CheckpointWriter(tempDir);
    writeCount = 0;

    // Mock writer to track calls
    const originalWrite = writer.write.bind(writer);
    writer.write = async (checkpoint: Checkpoint) => {
      writeCount++;
      return originalWrite(checkpoint);
    };
  });

  afterEach(async () => {
    scheduler.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("time-based intervals", () => {
    it("should trigger checkpoint at configured interval", async () => {
      scheduler.start(writer, createMockCheckpoint);

      vi.advanceTimersByTime(60100); // Default 60s interval + 100ms

      expect(writeCount).toBeGreaterThan(0);
    });

    it("should trigger periodic checkpoints", async () => {
      scheduler.start(writer, createMockCheckpoint);

      vi.advanceTimersByTime(60100);
      const count1 = writeCount;

      vi.advanceTimersByTime(60000);
      const count2 = writeCount;

      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe("activity-based triggering", () => {
    it("should trigger checkpoint when activity threshold reached", async () => {
      scheduler.start(writer, createMockCheckpoint);

      // Record 50 activity events
      for (let i = 0; i < 50; i++) {
        scheduler.recordActivity();
      }

      // Should have triggered checkpoint
      expect(writeCount).toBeGreaterThan(0);
    });

    it("should not trigger checkpoint below activity threshold", async () => {
      scheduler.start(writer, createMockCheckpoint);

      // Record fewer than 50 activity events
      for (let i = 0; i < 25; i++) {
        scheduler.recordActivity();
      }

      // Time-based interval hasn't fired yet, activity below threshold
      vi.advanceTimersByTime(30000); // 30s < default 60s
      expect(writeCount).toBe(0);
    });

    it("should reset activity counter after checkpoint", async () => {
      scheduler.start(writer, createMockCheckpoint);

      // Record 50 activity events
      for (let i = 0; i < 50; i++) {
        scheduler.recordActivity();
      }

      // Wait for the async triggerNow to complete (longer timeout for coverage instrumentation)
      await new Promise(r => setTimeout(r, 200));
      const count1 = writeCount;

      // Record 25 more (not enough to trigger again)
      for (let i = 0; i < 25; i++) {
        scheduler.recordActivity();
      }

      await new Promise(r => setTimeout(r, 200));
      expect(writeCount).toBe(count1); // No additional checkpoint
    });
  });

  describe("I/O backoff", () => {
    it("should increase interval when write is slow", async () => {
      // Mock slow write
      const slowWriter = new CheckpointWriter(tempDir);
      slowWriter.write = async () => {
        // Simulate 600ms write
        await new Promise(resolve => setTimeout(resolve, 600));
        writeCount++;
      };

      scheduler.start(slowWriter, createMockCheckpoint);

      // First checkpoint at 60s
      vi.advanceTimersByTime(60100);
      const _firstTime = Date.now();

      // The scheduler should have increased its interval
      vi.advanceTimersByTime(60100); // Only 60s more, but interval was doubled
      // With doubled interval (120s), no checkpoint should occur yet
      expect(writeCount).toBe(1);
    });

    it("should restore interval when write becomes fast", async () => {
      const slowWriter = new CheckpointWriter(tempDir);
      let isSlowWrite = true;

      slowWriter.write = async (checkpoint: Checkpoint) => {
        if (isSlowWrite) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        writeCount++;
        await fs.mkdir(path.join(tempDir, "recovery"), { recursive: true });
        await fs.writeFile(
          path.join(tempDir, "recovery", "checkpoint.json"),
          JSON.stringify(checkpoint)
        );
      };

      scheduler.start(slowWriter, createMockCheckpoint);

      // First slow write
      vi.advanceTimersByTime(60100);
      expect(writeCount).toBe(1);

      // Interval should be doubled now
      isSlowWrite = false;

      // Wait for fast write to occur and interval to restore
      vi.advanceTimersByTime(120100);
      expect(writeCount).toBeGreaterThan(1);

      // Interval should be back to normal now
      // Next checkpoint should be at original interval (60s)
      vi.advanceTimersByTime(60100);
      expect(writeCount).toBeGreaterThan(2);
    });
  });

  describe("manual triggering", () => {
    it("should trigger immediate checkpoint", async () => {
      scheduler.start(writer, createMockCheckpoint);

      await scheduler.triggerNow();
      expect(writeCount).toBeGreaterThan(0);
    });

    it("should support triggerNow without start", async () => {
      await expect(scheduler.triggerNow()).resolves.toBeUndefined();
    });
  });

  describe("graceful shutdown", () => {
    it("should stop scheduling", async () => {
      scheduler.start(writer, createMockCheckpoint);
      scheduler.stop();

      vi.advanceTimersByTime(120000);

      // Should not trigger any more checkpoints after stop
      const finalCount = writeCount;
      vi.advanceTimersByTime(120000);
      expect(writeCount).toBe(finalCount);
    });
  });

  describe("edge cases", () => {
    it("should handle checkpoint without explicit start", async () => {
      // Manually call the handler without starting scheduler
      await scheduler.triggerNow();
      expect(writeCount).toBe(0); // No writer set yet
    });

    it("should not crash on write failure", async () => {
      const failingWriter = new CheckpointWriter(tempDir);
      failingWriter.write = async () => {
        throw new Error("Write failed");
      };

      scheduler.start(failingWriter, createMockCheckpoint);

      // Should not throw
      await scheduler.triggerNow();
    });

    it("should track activity accurately across multiple events", async () => {
      scheduler.start(writer, createMockCheckpoint);

      for (let i = 0; i < 49; i++) {
        scheduler.recordActivity();
      }

      expect(writeCount).toBe(0);

      scheduler.recordActivity(); // 50th event
      expect(writeCount).toBeGreaterThan(0);
    });
  });
});
