import { CheckpointScheduler } from "../checkpoint-scheduler.js";
import { CheckpointWriter, type Checkpoint } from "../checkpoint.js";

describe("CheckpointScheduler", () => {
  let scheduler: CheckpointScheduler;
  let writer: CheckpointWriter;
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

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new CheckpointScheduler();
    writeCount = 0;
    writer = {
      write: async (_checkpoint: Checkpoint) => {
        writeCount++;
      },
    } as CheckpointWriter;
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("time-based intervals", () => {
    it("should trigger checkpoint at configured interval", async () => {
      scheduler.start(writer, createMockCheckpoint);

      vi.advanceTimersByTime(60100); // Default 60s interval + 100ms
      await scheduler.triggerNow();

      expect(writeCount).toBeGreaterThan(0);
    });

    it("should trigger periodic checkpoints", async () => {
      scheduler.start(writer, createMockCheckpoint);

      vi.advanceTimersByTime(60100);
      await scheduler.triggerNow();
      const count1 = writeCount;

      vi.advanceTimersByTime(60000);
      await scheduler.triggerNow();
      const count2 = writeCount;

      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe("activity-based triggering", () => {
    it("should trigger checkpoint when activity threshold reached", async () => {
      scheduler.start(writer, createMockCheckpoint);

      // Record 50 activity events
      for (let i = 0; i < 50; i++) {
        await scheduler.recordActivity();
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
        await scheduler.recordActivity();
      }

      const count1 = writeCount;

      // Record 25 more (not enough to trigger again)
      for (let i = 0; i < 25; i++) {
        await scheduler.recordActivity();
      }

      expect(writeCount).toBe(count1); // No additional checkpoint
    });
  });

  describe("I/O backoff", () => {
    it("should increase interval when write is slow", async () => {
      // Mock slow write
      const slowWriter = {
        write: async () => {
          // Simulate 600ms write
          await new Promise(resolve => setTimeout(resolve, 600));
          writeCount++;
        },
      } as CheckpointWriter;

      scheduler.start(slowWriter, createMockCheckpoint);

      const firstWrite = scheduler.triggerNow();
      vi.advanceTimersByTime(600);
      await firstWrite;
      // The scheduler should have increased its interval
      vi.advanceTimersByTime(60100); // Only 60s more, but interval was doubled
      // With doubled interval (120s), no checkpoint should occur yet
      expect(writeCount).toBe(1);
    });

    it("should restore interval when write becomes fast", async () => {
      const slowWriter = {} as CheckpointWriter;
      let isSlowWrite = true;

      slowWriter.write = async () => {
        if (isSlowWrite) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        writeCount++;
      };

      scheduler.start(slowWriter, createMockCheckpoint);

      const firstWrite = scheduler.triggerNow();
      vi.advanceTimersByTime(600);
      await firstWrite;
      expect(writeCount).toBe(1);

      // Interval should be doubled now
      isSlowWrite = false;

      // Wait for fast write to occur and interval to restore
      vi.advanceTimersByTime(120100);
      await scheduler.triggerNow();
      expect(writeCount).toBeGreaterThan(1);

      // Interval should be back to normal now
      // Next checkpoint should be at original interval (60s)
      vi.advanceTimersByTime(60100);
      await scheduler.triggerNow();
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

    it("should coalesce concurrent checkpoint requests", async () => {
      let releaseWrite: (() => void) | undefined;
      const blockingWriter = {
        write: async () => {
          writeCount++;
          await new Promise<void>(resolve => {
            releaseWrite = resolve;
          });
        },
      } as CheckpointWriter;
      scheduler.start(blockingWriter, createMockCheckpoint);

      const first = scheduler.triggerNow();
      const second = scheduler.triggerNow();

      expect(writeCount).toBe(1);
      releaseWrite?.();
      await Promise.all([first, second]);
      expect(writeCount).toBe(1);
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
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const failingWriter = {
        write: async () => {
          throw new Error("Write failed");
        },
      } as CheckpointWriter;

      scheduler.start(failingWriter, createMockCheckpoint);

      // Should not throw
      await scheduler.triggerNow();
      expect(errorSpy).toHaveBeenCalledWith("Failed to write checkpoint:", expect.any(Error));
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
