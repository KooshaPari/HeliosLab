/**
 * Durability layer that wires recovery primitives into the runtime lifecycle.
 *
 * Connects CheckpointScheduler, Watchdog, CrashLoopDetector, and SafeMode
 * to the runtime bus so that:
 * - Checkpoints are written periodically and on activity bursts.
 * - Crashes are detected, classified, and recorded.
 * - Crash loops trigger safe mode.
 * - Shutdown writes a final checkpoint.
 *
 * @module
 */

import type { LocalBus } from "../protocol/bus.js";
import type { Checkpoint, CheckpointSession } from "./checkpoint.js";
import { CheckpointReader, CheckpointWriter } from "./checkpoint.js";
import { CheckpointScheduler } from "./checkpoint-scheduler.js";
import { RestorationPipeline, type RestorationResult } from "./restoration.js";
import { CrashLoopDetector, SafeMode } from "./safe-mode.js";
import { RecoveryStateMachine } from "./state-machine.js";
import { Watchdog } from "./watchdog.js";

export interface DurabilityLayerOptions {
	/** Root directory for persistence (checkpoints, crash records, recovery state). */
	dataDir: string;
	bus: LocalBus;
	/** How often checkpoints are written. Default: 60s. */
	checkpointIntervalMs?: number;
	/** Crash threshold count. Default: 3. */
	crashThresholdCount?: number;
	/** Crash loop window in ms. Default: 60000. */
	crashWindowMs?: number;
}

/**
 * Build a checkpoint snapshot from the current runtime state.
 *
 * The caller supplies the live session list so the durability layer doesn't
 * need to know about the session registry internals.
 */
export type CheckpointSnapshotter = () => CheckpointSession[];

export class DurabilityLayer {
	private readonly bus: LocalBus;
	private readonly dataDir: string;
	private readonly writer: CheckpointWriter;
	private readonly reader: CheckpointReader;
	private readonly scheduler: CheckpointScheduler;
	private readonly watchdog: Watchdog;
	private readonly crashDetector: CrashLoopDetector;
	private readonly safeMode: SafeMode;
	private readonly stateMachine: RecoveryStateMachine;
	private readonly restoration: RestorationPipeline;
	private snapshotter?: CheckpointSnapshotter;
	private started = false;

	constructor(options: DurabilityLayerOptions) {
		this.dataDir = options.dataDir;
		this.bus = options.bus;
		this.writer = new CheckpointWriter(options.dataDir);
		this.reader = new CheckpointReader(options.dataDir);
		this.scheduler = new CheckpointScheduler();
		this.watchdog = new Watchdog(options.dataDir, options.bus);
		this.crashDetector = new CrashLoopDetector(
			options.dataDir,
			options.crashThresholdCount ?? 3,
			options.crashWindowMs ?? 60000,
		);
		this.safeMode = new SafeMode(options.bus);
		this.stateMachine = new RecoveryStateMachine(options.dataDir, options.bus);
		this.restoration = new RestorationPipeline(options.bus);
	}

	/**
	 * Start the durability layer. Initializes crash history from disk,
	 * wires the watchdog crash handler to the crash loop detector and
	 * safe mode, and starts the checkpoint scheduler.
	 */
	async start(snapshotter: CheckpointSnapshotter): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.snapshotter = snapshotter;

		await this.crashDetector.initialize();
		await this.stateMachine.initialize();

		// Wire watchdog -> crash loop detector -> safe mode
		this.watchdog.onCrashDetected(async (event) => {
			await this.crashDetector.recordCrash(event.timestamp);
			if (this.crashDetector.isLooping()) {
				await this.safeMode.enter();
			}
		});

		// Start periodic checkpoint scheduler
		this.scheduler.start(this.writer, () => this.buildCheckpoint());
	}

	/**
	 * Trigger an immediate checkpoint write (activity burst).
	 */
	recordActivity(): void {
		if (!this.started) return;
		this.scheduler.recordActivity();
	}

	/**
	 * Write a checkpoint immediately and wait for it to complete.
	 */
	async checkpointNow(): Promise<void> {
		await this.scheduler.triggerNow();
	}

	/**
	 * Read the latest checkpoint from disk.
	 */
	async readCheckpoint(): Promise<Checkpoint | null> {
		return this.reader.read();
	}

	/**
	 * Run the restoration pipeline against the latest checkpoint.
	 */
	async restore(): Promise<RestorationResult | null> {
		const checkpoint = await this.reader.read();
		if (!checkpoint) return null;
		return this.restoration.restore(checkpoint);
	}

	/**
	 * Get the current recovery stage.
	 */
	getRecoveryStage(): string {
		return this.stateMachine.getCurrentStage();
	}

	/**
	 * Check if safe mode is active.
	 */
	isSafeModeActive(): boolean {
		return this.safeMode.isActive();
	}

	/**
	 * Write a final checkpoint and stop the scheduler.
	 * Must be called during graceful shutdown.
	 */
	async shutdown(): Promise<void> {
		if (!this.started) return;
		this.started = false;

		// Write final checkpoint
		try {
			await this.scheduler.triggerNow();
		} catch {
			// Best-effort during shutdown
		}

		this.scheduler.stop();
		this.watchdog.dispose();
	}

	/** Expose watchdog for process registration. */
	get watchdogInstance(): Watchdog {
		return this.watchdog;
	}

	/** Expose safe mode for external queries. */
	get safeModeInstance(): SafeMode {
		return this.safeMode;
	}

	private buildCheckpoint(): Checkpoint {
		const sessions = this.snapshotter ? this.snapshotter() : [];
		return {
			version: 1,
			timestamp: Date.now(),
			checksum: "",
			sessions,
		};
	}
}
