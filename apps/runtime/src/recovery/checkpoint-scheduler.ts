import type { Checkpoint } from "./checkpoint.js";
import type { CheckpointWriter } from "./checkpoint.js";

const DEFAULT_CHECKPOINT_INTERVAL_MS = 60000; // 60 seconds
const ACTIVITY_THRESHOLD = 50; // Activity events before triggering checkpoint
const MIN_WRITE_TIME_FOR_BACKOFF = 500; // ms
const MAX_WRITE_TIME_FOR_RESTORE = 100; // ms
const MAX_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FINAL_CHECKPOINT_TIMEOUT = 5000; // 5 seconds for graceful shutdown

export class CheckpointScheduler {
  private writer?: CheckpointWriter;
  private stateGetter?: () => Checkpoint;
  private isRunning = false;
  private timerInterval?: NodeJS.Timeout;
  private currentInterval = DEFAULT_CHECKPOINT_INTERVAL_MS;
  private activityCounter = 0;
  private lastCheckpointTime = 0;
  private lastWriteDurationMs = 0;
  private checkpointInFlight?: Promise<void>;
  private readonly onSigterm = (): void => {
    void this.handleShutdown();
  };
  private readonly onSigint = (): void => {
    void this.handleShutdown();
  };

  start(writer: CheckpointWriter, stateGetter: () => Checkpoint): void {
    if (this.isRunning) return;

    this.writer = writer;
    this.stateGetter = stateGetter;
    this.isRunning = true;
    this.lastCheckpointTime = Date.now();

    // Set up periodic timer
    this.timerInterval = setInterval(() => {
      this.onTimer();
    }, this.currentInterval);

    // Hook into shutdown signals
    process.on("SIGTERM", this.onSigterm);
    process.on("SIGINT", this.onSigint);
  }

  async stop(): Promise<void> {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
    process.off("SIGTERM", this.onSigterm);
    process.off("SIGINT", this.onSigint);
    this.isRunning = false;
    await this.checkpointInFlight;
  }

  async triggerNow(): Promise<void> {
    if (!this.writer || !this.stateGetter) return;
    if (this.checkpointInFlight) return this.checkpointInFlight;

    const operation = this.writeCheckpoint();
    this.checkpointInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.checkpointInFlight === operation) {
        this.checkpointInFlight = undefined;
      }
    }
  }

  private async writeCheckpoint(): Promise<void> {
    if (!this.writer || !this.stateGetter) return;
    const checkpoint = this.stateGetter();
    const startTime = Date.now();

    try {
      await this.writer.write(checkpoint);
      this.lastWriteDurationMs = Date.now() - startTime;
      this.lastCheckpointTime = Date.now();
      this.activityCounter = 0;

      // Adjust interval based on write time
      this.adjustInterval();
    } catch (err) {
      console.error("Failed to write checkpoint:", err);
    }
  }

  recordActivity(): Promise<void> {
    this.activityCounter++;

    // Check if activity threshold exceeded
    if (this.activityCounter >= ACTIVITY_THRESHOLD) {
      return this.triggerNow().catch(err => {
        console.error("Activity-triggered checkpoint failed:", err);
      });
    }

    return Promise.resolve();
  }

  private onTimer(): void {
    this.triggerNow().catch(err => {
      console.error("Periodic checkpoint failed:", err);
    });
  }

  private adjustInterval(): void {
    if (this.lastWriteDurationMs > MIN_WRITE_TIME_FOR_BACKOFF) {
      // Backoff: increase interval
      this.currentInterval = Math.min(this.currentInterval * 2, MAX_INTERVAL_MS);
    } else if (this.lastWriteDurationMs < MAX_WRITE_TIME_FOR_RESTORE) {
      // Restore: decrease interval back to default
      this.currentInterval = DEFAULT_CHECKPOINT_INTERVAL_MS;
    }

    // Restart timer with new interval
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        this.onTimer();
      }, this.currentInterval);
    }
  }

  private async handleShutdown(): Promise<void> {
    // Take final checkpoint synchronously (with timeout)
    if (!this.writer || !this.stateGetter) return;

    const writePromise = this.triggerNow();

    // Race: wait for write or timeout
    await Promise.race([
      writePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Checkpoint timeout")), FINAL_CHECKPOINT_TIMEOUT)
      ),
    ]).catch(err => {
      console.error("Final checkpoint on shutdown failed:", err);
    });

    await this.stop();
  }
}
