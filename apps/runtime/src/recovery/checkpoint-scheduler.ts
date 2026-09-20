import type { Checkpoint, CheckpointWriter } from "./checkpoint.js";

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
	private lastWriteDurationMs = 0;
	private pendingTrigger?: Promise<void>;
	// Track SIGTERM/SIGINT listeners so `stop()` can detach them.
	// Without this, every fresh `start()` accumulates another pair on
	// `process`, which leaks into the next creator instance and across
	// Bun:test test boundaries — exactly the situation that kept
	// `unit-check` from draining between slice-3 integration tests on
	// the slow Ubuntu CI runner.
	private sigtermHandler?: () => void;
	private sigintHandler?: () => void;

	start(writer: CheckpointWriter, stateGetter: () => Checkpoint): void {
		if (this.isRunning) return;

		this.writer = writer;
		this.stateGetter = stateGetter;
		this.isRunning = true;

		// Set up periodic timer
		this.timerInterval = setInterval(() => {
			this.onTimer();
		}, this.currentInterval);

		// Hook into shutdown signals — store references so `stop()`
		// can detach them. Re-binding the same instance across
		// `start()` calls is idempotent because we early-return above.
		this.sigtermHandler = () => this.handleShutdown();
		this.sigintHandler = () => this.handleShutdown();
		process.on("SIGTERM", this.sigtermHandler);
		process.on("SIGINT", this.sigintHandler);
	}

	stop(): void {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = undefined;
		}
		if (this.sigtermHandler) {
			process.off("SIGTERM", this.sigtermHandler);
			this.sigtermHandler = undefined;
		}
		if (this.sigintHandler) {
			process.off("SIGINT", this.sigintHandler);
			this.sigintHandler = undefined;
		}
		this.isRunning = false;
	}

	triggerNow(): Promise<void> {
		if (this.pendingTrigger) return this.pendingTrigger;

		const trigger = this.performTrigger();
		const ownedTrigger = trigger.finally(() => {
			if (this.pendingTrigger === ownedTrigger) this.pendingTrigger = undefined;
		});
		this.pendingTrigger = ownedTrigger;
		return ownedTrigger;
	}

	async waitForIdle(): Promise<void> {
		await this.pendingTrigger;
	}

	getCurrentIntervalMs(): number {
		return this.currentInterval;
	}

	private async performTrigger(): Promise<void> {
		if (!this.writer || !this.stateGetter) return;

		const checkpoint = this.stateGetter();
		const startTime = Date.now();

		try {
			await this.writer.write(checkpoint);
			this.lastWriteDurationMs = Date.now() - startTime;
			this.activityCounter = 0;

			// Adjust interval based on write time
			this.adjustInterval();
		} catch (err) {
			console.error("Failed to write checkpoint:", err);
		}
	}

	recordActivity(): void {
		this.activityCounter++;

		// Check if activity threshold exceeded
		if (this.activityCounter >= ACTIVITY_THRESHOLD) {
			this.triggerNow().catch((err) => {
				console.error("Activity-triggered checkpoint failed:", err);
			});
		}
	}

	private onTimer(): void {
		this.triggerNow().catch((err) => {
			console.error("Periodic checkpoint failed:", err);
		});
	}

	private adjustInterval(): void {
		if (this.lastWriteDurationMs > MIN_WRITE_TIME_FOR_BACKOFF) {
			// Backoff: increase interval
			this.currentInterval = Math.min(
				this.currentInterval * 2,
				MAX_INTERVAL_MS,
			);
		} else if (this.lastWriteDurationMs <= MAX_WRITE_TIME_FOR_RESTORE) {
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

		const checkpoint = this.stateGetter();
		const writePromise = this.writer.write(checkpoint);

		// Race: wait for write or timeout
		await Promise.race([
			writePromise,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("Checkpoint timeout")),
					FINAL_CHECKPOINT_TIMEOUT,
				),
			),
		]).catch((err) => {
			console.error("Final checkpoint on shutdown failed:", err);
		});

		this.stop();
	}
}
