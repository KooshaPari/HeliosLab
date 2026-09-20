/**
 * DurabilityLayer — Slice 2 lifecycle wiring for runtime durability.
 *
 * Composes a CheckpointWriter, CheckpointReader, and CheckpointScheduler
 * behind a single lifecycle API (`start`, `shutdown`, `recordActivity`,
 * `readCheckpoint`, `checkpointNow`).
 *
 * `start(snapshotter)` installs the snapshot provider so the scheduler
 * can materialize a `Checkpoint` whenever its periodic timer or activity
 * threshold fires. `checkpointNow()` performs a synchronous snapshot +
 * write on demand (e.g. on `terminal.spawn` or process shutdown).
 */

import { createHash } from "node:crypto";
import {
	CHECKPOINT_VERSION,
	type Checkpoint,
	CheckpointReader,
	type CheckpointSession,
	CheckpointWriter,
} from "./checkpoint.js";
import { CheckpointScheduler } from "./checkpoint-scheduler.js";

export type Snapshotter = () => CheckpointSession[];

export interface DurabilityLayerOptions {
	dataDir: string;
	snapshotter?: Snapshotter;
	schedulerIntervalMs?: number;
	activityThreshold?: number;
}

export interface DurabilityLayerSnapshot {
	readonly version: number;
	readonly dataDir: string;
	readonly running: boolean;
	readonly lastCheckpointAt: number | null;
	readonly lastSessions: number;
}

export class DurabilityLayer {
	private readonly dataDir: string;
	private readonly writer: CheckpointWriter;
	private readonly reader: CheckpointReader;
	private readonly scheduler = new CheckpointScheduler();
	private snapshotter?: Snapshotter;
	private running = false;
	private lastCheckpointAt: number | null = null;
	private lastSessions = 0;

	constructor(options: DurabilityLayerOptions) {
		if (
			!options ||
			typeof options.dataDir !== "string" ||
			options.dataDir.length === 0
		) {
			throw new Error("DurabilityLayer requires a non-empty dataDir");
		}
		this.dataDir = options.dataDir;
		this.writer = new CheckpointWriter(options.dataDir);
		this.reader = new CheckpointReader(options.dataDir);
		if (options.snapshotter) {
			this.snapshotter = options.snapshotter;
		}
	}

	start(snapshotter: Snapshotter): void {
		if (this.running) {
			// Allow updating the snapshotter without restarting.
			this.snapshotter = snapshotter;
			return;
		}
		this.snapshotter = snapshotter;
		this.scheduler.start(this.writer, () => this.collectCheckpoint());
		this.running = true;
	}

	/**
	 * Update the snapshotter mid-flight without restarting the scheduler.
	 * Useful when the runtime obtains a new session-registry reference.
	 */
	setSnapshotter(snapshotter: Snapshotter): void {
		this.snapshotter = snapshotter;
	}

	async shutdown(): Promise<void> {
		if (!this.running) return;
		// One last checkpoint so the on-disk state reflects the moment of
		// graceful shutdown (subject to the scheduler's internal timeout).
		try {
			await this.scheduler.triggerNow();
		} catch (err) {
			console.error("DurabilityLayer.shutdown: final checkpoint failed", err);
		}
		this.scheduler.stop();
		this.running = false;
	}

	recordActivity(): void {
		if (!this.running) return;
		this.scheduler.recordActivity();
	}

	async checkpointNow(): Promise<void> {
		const checkpoint = this.collectCheckpoint();
		await this.writer.write(checkpoint);
		this.lastCheckpointAt = checkpoint.timestamp;
		this.lastSessions = checkpoint.sessions.length;
	}

	async readCheckpoint(): Promise<Checkpoint | null> {
		const existing = await this.reader.read();
		if (existing) {
			this.lastCheckpointAt = existing.timestamp;
			this.lastSessions = existing.sessions.length;
		}
		return existing;
	}

	getWriter(): CheckpointWriter {
		return this.writer;
	}

	getReader(): CheckpointReader {
		return this.reader;
	}

	getScheduler(): CheckpointScheduler {
		return this.scheduler;
	}

	getDataDir(): string {
		return this.dataDir;
	}

	isRunning(): boolean {
		return this.running;
	}

	snapshot(): DurabilityLayerSnapshot {
		return {
			version: CHECKPOINT_VERSION,
			dataDir: this.dataDir,
			running: this.running,
			lastCheckpointAt: this.lastCheckpointAt,
			lastSessions: this.lastSessions,
		};
	}

	private collectCheckpoint(): Checkpoint {
		const sessions = this.snapshotter ? this.snapshotter() : [];
		const sessionsJson = JSON.stringify(sessions);
		const checksum = createHash("sha256").update(sessionsJson).digest("hex");
		const checkpoint: Checkpoint = {
			version: CHECKPOINT_VERSION,
			timestamp: Date.now(),
			checksum,
			sessions,
		};
		this.lastCheckpointAt = checkpoint.timestamp;
		this.lastSessions = sessions.length;
		return checkpoint;
	}
}
