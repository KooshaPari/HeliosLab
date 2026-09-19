/**
 * Terminal-first vertical slice driver.
 *
 * The runtime built by `createRuntime()` simulates terminals entirely on the
 * local bus: it appends to an in-memory buffer and publishes events, but it
 * never spawns a process and never reaches a renderer. The PTY, lane and
 * renderer layers all exist as libraries with no in-process consumer.
 *
 * This driver is that consumer. It subscribes to the lifecycle topics that
 * {@link LaneLifecycleService} already publishes and materialises one real
 * PTY per lane, piping the child's stdout into a renderer surface through
 * {@link StreamBindingManager}.
 *
 * Flow:
 *   lane.created               -> PtyManager.spawn -> bind stdout to renderer
 *   lane.cleaned / lane.closed -> unbind -> PtyManager.terminate
 *
 * The driver is strictly additive. It does not change the existing runtime
 * path and `stop()` detaches it cleanly.
 *
 * @module
 */

import type { EventEnvelope, LocalBus } from "../protocol/bus.js";
import type { PtyProcessHandle, PtyRecord } from "../pty/index.js";
import { PtyManager } from "../pty/index.js";
import type { RendererAdapter } from "../renderer/adapter.js";
import { StreamBindingManager } from "../renderer/stream_binding.js";

/** Lifecycle topic that materialises a terminal for a lane. */
const SPAWN_TOPIC = "lane.created";

/** Lifecycle topics that tear a lane's terminal down. */
const TEARDOWN_TOPICS = ["lane.cleaned", "lane.closed"] as const;

/**
 * Concurrency target for concurrent PTYs.
 *
 * The {@link PtyManager} default of 300 predates the near-term concurrency
 * target of 1000 sessions, so the driver raises it.
 */
const DEFAULT_MAX_PTYS = 1000;

/** A lane's live terminal binding. */
export interface LaneTerminalBinding {
	laneId: string;
	ptyId: string;
	sessionId: string;
	terminalId: string;
	proc: PtyProcessHandle;
}

/** Records a lane whose terminal could not be materialised. */
export interface DriverSpawnError {
	laneId: string;
	message: string;
}

export interface VerticalSliceDriverOptions {
	bus: LocalBus;
	renderer: RendererAdapter;
	ptyManager?: PtyManager;
	streamBindingManager?: StreamBindingManager;
	/** Shell binary to spawn. Defaults to the platform shell. */
	shell?: string;
	cols?: number;
	rows?: number;
	/** Maximum concurrent PTYs (default 1000). */
	maxPtys?: number;
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export class VerticalSliceDriver {
	private readonly bus: LocalBus;
	private readonly renderer: RendererAdapter;
	private readonly ptyManager: PtyManager;
	private readonly streamBindings: StreamBindingManager;
	private readonly shell: string | undefined;
	private readonly cols: number;
	private readonly rows: number;

	private readonly byLane = new Map<string, LaneTerminalBinding>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly unsubscribers: Array<() => void> = [];
	private readonly spawnErrors: DriverSpawnError[] = [];
	private started = false;

	constructor(options: VerticalSliceDriverOptions) {
		this.bus = options.bus;
		this.renderer = options.renderer;
		this.ptyManager =
			options.ptyManager ?? new PtyManager(options.maxPtys ?? DEFAULT_MAX_PTYS);
		this.streamBindings =
			options.streamBindingManager ?? new StreamBindingManager();
		this.shell = options.shell;
		this.cols = options.cols ?? 80;
		this.rows = options.rows ?? 24;
	}

	/** Attach to the bus. Idempotent. */
	start(): void {
		if (this.started) return;
		this.started = true;

		this.unsubscribers.push(
			this.bus.subscribe(SPAWN_TOPIC, (evt) => {
				this.track(this.handleLaneCreated(evt));
			}),
		);

		for (const topic of TEARDOWN_TOPICS) {
			this.unsubscribers.push(
				this.bus.subscribe(topic, (evt) => {
					this.track(this.handleLaneClosed(evt));
				}),
			);
		}
	}

	/** Detach from the bus. Does not terminate PTYs. */
	stop(): void {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers.length = 0;
		this.started = false;
	}

	/** Detach and terminate every PTY the driver spawned. */
	async shutdown(): Promise<void> {
		this.stop();
		const bindings = [...this.byLane.values()];
		this.byLane.clear();
		for (const binding of bindings) {
			this.streamBindings.unbind(binding.ptyId);
			try {
				await this.ptyManager.terminate(binding.ptyId);
			} catch {
				// Termination is best-effort during shutdown.
			}
		}
		await this.settle();
	}

	/** The live binding for a lane, or `undefined`. */
	bindingForLane(laneId: string): LaneTerminalBinding | undefined {
		return this.byLane.get(laneId);
	}

	/** The PTY id backing a lane, or `undefined`. */
	ptyForLane(laneId: string): string | undefined {
		return this.byLane.get(laneId)?.ptyId;
	}

	/** Every lane currently backed by a live PTY. */
	laneIds(): readonly string[] {
		return [...this.byLane.keys()];
	}

	/** The underlying PTY manager, for introspection. */
	get ptys(): PtyManager {
		return this.ptyManager;
	}

	/** The underlying stream binding manager, for introspection. */
	get bindings(): StreamBindingManager {
		return this.streamBindings;
	}

	/** Lanes whose terminal could not be materialised. */
	get errors(): readonly DriverSpawnError[] {
		return this.spawnErrors;
	}

	/** Write input text to a lane's terminal. */
	writeToLane(laneId: string, data: string): void {
		const binding = this.byLane.get(laneId);
		if (!binding) {
			throw new Error(`no live terminal for lane '${laneId}'`);
		}
		this.ptyManager.writeInput(binding.ptyId, new TextEncoder().encode(data));
	}

	/** Resolve once a lane has a live terminal, or when `timeoutMs` elapses. */
	async waitForLane(
		laneId: string,
		timeoutMs = 5000,
	): Promise<LaneTerminalBinding | null> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const binding = this.byLane.get(laneId);
			if (binding) return binding;
			if (Date.now() >= deadline) return null;
			await delay(5);
		}
	}

	/** Await all in-flight spawn and teardown work. */
	async settle(): Promise<void> {
		while (this.pending.size > 0) {
			await Promise.allSettled([...this.pending]);
		}
	}

	private track<T>(promise: Promise<T>): Promise<T> {
		this.pending.add(promise);
		void promise.finally(() => {
			this.pending.delete(promise);
		});
		return promise;
	}

	private static laneIdOf(evt: EventEnvelope): string | undefined {
		if (typeof evt.lane_id === "string") return evt.lane_id;
		const payloadLaneId = evt.payload?.["lane_id"];
		if (typeof payloadLaneId === "string") {
			return payloadLaneId;
		}
		return undefined;
	}

	private async handleLaneCreated(evt: EventEnvelope): Promise<void> {
		const laneId = VerticalSliceDriver.laneIdOf(evt);
		if (!laneId) return;
		// Idempotent: a repeated lane.created must not spawn a second PTY.
		if (this.byLane.has(laneId)) return;
		await this.spawnForLane(laneId);
	}

	private async handleLaneClosed(evt: EventEnvelope): Promise<void> {
		const laneId = VerticalSliceDriver.laneIdOf(evt);
		if (!laneId) return;
		const binding = this.byLane.get(laneId);
		if (!binding) return;
		this.byLane.delete(laneId);

		// Detach first so the renderer's cell count freezes, then terminate.
		this.streamBindings.unbind(binding.ptyId);
		try {
			await this.ptyManager.terminate(binding.ptyId);
		} catch {
			// Termination is best-effort; the binding is already detached.
		}
	}

	private async spawnForLane(laneId: string): Promise<void> {
		const sessionId = `session:${laneId}`;
		const terminalId = `terminal:${laneId}`;

		let record: PtyRecord;
		try {
			record = await this.ptyManager.spawn({
				shell: this.shell,
				laneId,
				sessionId,
				terminalId,
				cols: this.cols,
				rows: this.rows,
			});
		} catch (error) {
			this.spawnErrors.push({
				laneId,
				message: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		const proc = this.ptyManager.getProcess(record.ptyId);
		if (!proc) {
			this.spawnErrors.push({
				laneId,
				message: `PTY '${record.ptyId}' spawned without a process handle`,
			});
			return;
		}

		if (proc.stdout) {
			this.streamBindings.bind(record.ptyId, proc.stdout, this.renderer);
		}

		this.byLane.set(laneId, {
			laneId,
			ptyId: record.ptyId,
			sessionId,
			terminalId,
			proc,
		});
	}
}
