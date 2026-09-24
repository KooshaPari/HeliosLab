import type { MethodHandler } from "../methods.js";
import type { LocalBusEnvelope } from "../types.js";
import { ProtocolValidationError } from "../types.js";
import { validateEnvelope } from "../validator.js";
import {
	isStartTopic,
	isTerminalTopic,
	resolveExpectedStartTopic,
} from "./lifecycle.js";
import { MetricsRecorder } from "./metrics.js";
import {
	handleLaneAttach,
	handleLaneCreate,
	handleRendererCapabilities,
	handleRendererSwitch,
	handleSessionAttach,
	handleTerminalInput,
	handleTerminalSpawn,
	type RequestHandlerContext,
} from "./request-handlers.js";
import type {
	AuditRecord,
	BusState,
	EventEnvelope,
	LocalBus,
	LocalBusEnvelopeWithSequence,
	ResponseEnvelope,
} from "./types.js";

export { CommandBusImpl, createBus } from "./command-bus.js";

/**
 * Topic sentinel accepted by `subscribe()` to receive every published event.
 * `BusAuditSubscriber` relies on it for its all-topics audit capture.
 */
const WILDCARD_TOPIC = "*";

/**
 * `EventEnvelope` does not declare `id`/`ts`, but every accepted envelope
 * carries both and subscribers need them to correlate deliveries. This bus
 * delivers them, matching `CommandBusImpl`, which passes the source envelope
 * through untouched. Widening the shared interface is a separate API change and
 * is tracked as a follow-up rather than folded into this slice.
 */
type DeliveredEventEnvelope = EventEnvelope & {
	id?: string;
	ts?: string;
};

// ---------------------------------------------------------------------------
// InMemoryLocalBus — protocol lifecycle implementation
// ---------------------------------------------------------------------------

export class InMemoryLocalBus implements LocalBus {
	private readonly eventLog: LocalBusEnvelope[] = [];
	private readonly auditLog: AuditRecord[] = [];
	private readonly metricsRecorder: MetricsRecorder = new MetricsRecorder();
	private state: BusState = { session: "detached" };
	private readonly lifecycleProgress: Map<string, Set<string>> = new Map();
	private rendererEngine: "ghostty" | "rio" = "ghostty";
	private readonly subscribers = new Map<
		string,
		Array<{
			handler: (evt: EventEnvelope) => void | Promise<void>;
			removed: boolean;
		}>
	>();

	getEvents(): LocalBusEnvelope[] {
		return [...this.eventLog];
	}

	/**
	 * Push an event directly to the event log without validation.
	 * Used by HTTP routing layer for events that don't follow protocol lifecycle ordering.
	 */
	pushEvent(event: LocalBusEnvelope): void {
		const sequencedEvent = event as LocalBusEnvelopeWithSequence;
		if (sequencedEvent.sequence === undefined) {
			sequencedEvent.sequence = this.getSequence() + 1;
		}
		this.auditLog.push({ envelope: event, outcome: "accepted" });
		this.eventLog.push(event);
	}

	getAuditRecords(): Promise<AuditRecord[]> {
		return Promise.resolve([...this.auditLog]);
	}

	getMetricsReport() {
		return this.metricsRecorder.getMetricsReport();
	}

	getState(): BusState {
		return { ...this.state };
	}

	private getSequence(): number {
		return this.eventLog.filter((e) => e.type === "event").length;
	}

	async publish(event: LocalBusEnvelope): Promise<void> {
		await Promise.resolve();
		// Validate the envelope
		try {
			validateEnvelope(event);
		} catch (err: unknown) {
			const auditErr =
				err instanceof ProtocolValidationError ? err.message : String(err);
			this.auditLog.push({
				envelope: event,
				outcome: "rejected",
				error: auditErr,
			});
			throw err;
		}

		// Check ordering: start topics must appear before terminal topics for same correlation
		const _topic = event.topic;
		const correlationId = event.correlation_id ?? "";

		if (_topic) {
			const isTerminal = isTerminalTopic(_topic);
			const isStart = isStartTopic(_topic);

			if (isStart) {
				if (!this.lifecycleProgress.has(correlationId)) {
					this.lifecycleProgress.set(correlationId, new Set());
				}
				const progress = this.lifecycleProgress.get(correlationId);
				if (!progress) {
					throw new ProtocolValidationError(
						"ORDERING_VIOLATION",
						`Missing lifecycle progress for correlation "${correlationId}"`,
					);
				}
				if (progress.has(_topic)) {
					const err = new ProtocolValidationError(
						"ORDERING_VIOLATION",
						`Duplicate start topic "${_topic}" for correlation "${correlationId}"`,
					);
					this.auditLog.push({
						envelope: event,
						outcome: "rejected",
						error: err.message,
					});
					throw err;
				}
				progress.add(_topic);

				const sequencedEvent = event as LocalBusEnvelopeWithSequence;
				if (sequencedEvent.sequence === undefined) {
					sequencedEvent.sequence = this.getSequence() + 1;
				}

				this.auditLog.push({ envelope: event, outcome: "accepted" });
				this.eventLog.push(event);
				this.dispatchToSubscribers(_topic, event, sequencedEvent);
				return;
			}

			if (isTerminal) {
				const seen = this.lifecycleProgress.get(correlationId);
				const expectedStart = resolveExpectedStartTopic(_topic);

				if (!seen?.has(expectedStart) && expectedStart !== _topic) {
					const err = new ProtocolValidationError(
						"ORDERING_VIOLATION",
						`Topic '${_topic}' cannot be published before '${expectedStart}'`,
					);
					this.auditLog.push({
						envelope: event,
						outcome: "rejected",
						error: err.message,
					});
					throw err;
				}

				this.lifecycleProgress.delete(correlationId);
			}

			// Handle terminal.output metrics
			if (_topic === "terminal.output") {
				const backlogDepth =
					typeof event.payload?.backlog_depth === "number"
						? event.payload.backlog_depth
						: undefined;
				const tags: Record<string, string> = {};
				if (event.session_id) {
					tags.session_id = event.session_id;
				}
				if (event.lane_id) {
					tags.lane_id = event.lane_id;
				}
				if (event.terminal_id) {
					tags.terminal_id = event.terminal_id;
				}
				this.metricsRecorder.recordMetric(
					"terminal_output_backlog_depth",
					backlogDepth,
					Object.keys(tags).length > 0 ? tags : undefined,
				);
				this.metricsRecorder.emitMetricEvent(
					"terminal_output_backlog_depth",
					backlogDepth,
					this.eventLog,
					this.auditLog,
				);
			}
		}

		// Assign sequence if not already set
		const sequencedEvent = event as LocalBusEnvelopeWithSequence;
		if (sequencedEvent.sequence === undefined) {
			sequencedEvent.sequence = this.getSequence() + 1;
		}
		this.auditLog.push({ envelope: event, outcome: "accepted" });
		this.eventLog.push(event);
		this.dispatchToSubscribers(_topic, event, sequencedEvent);
	}

	/**
	 * Fan an accepted event out to its topic subscribers.
	 *
	 * Contract:
	 *  - Exact-topic subscribers and `"*"` (all-topics) subscribers both fire.
	 *  - Handlers are snapshotted before iteration so unsubscribing during
	 *    dispatch cannot skip or re-order the in-flight delivery (FR-010).
	 *  - Synchronous throws and rejected promises are swallowed (FR-009
	 *    subscriber isolation).
	 *  - Promise-returning handlers are NOT awaited. `Watchdog.handleCrash()`
	 *    awaits `publish()` before it records the crash with the durability
	 *    layer, so a subscriber whose promise never settles (stalled telemetry
	 *    I/O, for example) must not be able to stall crash recovery. The
	 *    handler is still invoked synchronously with the accepted envelope.
	 *  - Each subscriber gets its own detached copy of the envelope, carrying
	 *    the same `id` and `ts` as the accepted event. Consumers can correlate
	 *    and order deliveries without re-reading `getEvents()`, and cannot
	 *    mutate the retained event/audit log through a shared `payload`
	 *    reference.
	 *
	 * `timestamp` is intentionally not forwarded: `LocalBusEnvelope` types it
	 * as epoch milliseconds, but `validateEnvelope` only accepts an ISO-8601
	 * string for that field, so no accepted event can carry a numeric one.
	 */
	private dispatchToSubscribers(
		topic: string | undefined,
		event: LocalBusEnvelope,
		sequencedEvent: LocalBusEnvelopeWithSequence,
	): void {
		if (!topic) return;

		const exact = this.subscribers.get(topic);
		const wildcard = this.subscribers.get(WILDCARD_TOPIC);
		if (!exact && !wildcard) return;

		const baseEnvelope: DeliveredEventEnvelope = {
			id: event.id,
			type: "event",
			topic,
			...(event.ts !== undefined && { ts: event.ts }),
			...(event.correlation_id !== undefined && {
				correlation_id: event.correlation_id,
			}),
			...(sequencedEvent.sequence !== undefined && {
				sequence: sequencedEvent.sequence,
			}),
			...(event.payload !== undefined && { payload: event.payload }),
			...(event.workspace_id !== undefined && {
				workspace_id: event.workspace_id,
			}),
			...(event.lane_id !== undefined && { lane_id: event.lane_id }),
			...(event.session_id !== undefined && { session_id: event.session_id }),
			...(event.terminal_id !== undefined && {
				terminal_id: event.terminal_id,
			}),
		};

		const snapshot: Array<(evt: EventEnvelope) => void | Promise<void>> = [
			...(exact ?? []).map((entry) => entry.handler),
			...(wildcard ?? []).map((entry) => entry.handler),
		];

		for (const handler of snapshot) {
			try {
				// Hand each subscriber its own copy: a consumer that mutates
				// `payload` must not be able to rewrite what later subscribers
				// see, nor what `getEvents()`/`getAuditRecords()` retain.
				const result = handler(structuredClone(baseEnvelope));
				if (result && typeof (result as Promise<void>).then === "function") {
					// Attach a rejection sink so an async failure stays isolated,
					// but deliberately do not await: see the contract above.
					void (result as Promise<void>).catch(() => {
						// FR-009: async subscriber failures are isolated.
					});
				}
			} catch {
				// FR-009: synchronous subscriber failures are isolated.
			}
		}
	}

	private getHandlerContext(): RequestHandlerContext {
		return {
			state: this.state,
			lifecycleProgress: this.lifecycleProgress,
			eventLog: this.eventLog,
			auditLog: this.auditLog,
			metricsRecorder: this.metricsRecorder,
			rendererEngine: this.rendererEngine,
			setState: (newState: BusState) => {
				this.state = newState;
			},
			setRendererEngine: (engine: "ghostty" | "rio") => {
				this.rendererEngine = engine;
			},
		};
	}

	async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
		await Promise.resolve();
		if (command.method) {
			const needsCorrelation = [
				"lane.create",
				"lane.attach",
				"session.attach",
				"terminal.spawn",
				"terminal.input",
				"terminal.resize",
			];
			if (
				needsCorrelation.includes(command.method) &&
				!command.correlation_id
			) {
				return {
					id: `res-${Date.now()}`,
					type: "response",
					ts: new Date().toISOString(),
					status: "error",
					error: {
						code: "MISSING_CORRELATION_ID",
						message: "correlation_id is required",
						retryable: false,
					},
				};
			}

			const startTime = Date.now();
			const ctx = this.getHandlerContext();

			if (command.method === "lane.create")
				return handleLaneCreate(command, startTime, ctx);
			if (command.method === "lane.attach")
				return handleLaneAttach(command, ctx);
			if (command.method === "session.attach")
				return handleSessionAttach(command, startTime, ctx);
			if (command.method === "terminal.spawn")
				return handleTerminalSpawn(command, startTime, ctx);
			if (command.method === "terminal.input")
				return handleTerminalInput(command);
			if (command.method === "renderer.capabilities")
				return handleRendererCapabilities(this.rendererEngine);
			if (command.method === "renderer.switch")
				return handleRendererSwitch(command, ctx);
		}

		return {
			id: command.id,
			type: "response",
			ts: new Date().toISOString(),
			status: "ok",
			result: {},
		};
	}

	// Implement LocalBus interface (stub methods)
	registerMethod(_method: string, _handler: MethodHandler): void {
		// Stub for interface compliance
	}

	async send(_envelope: unknown): Promise<ResponseEnvelope> {
		return {
			id: "stub",
			type: "response",
			ts: new Date().toISOString(),
			status: "ok",
		};
	}

	subscribe(
		topic: string,
		handler: (evt: EventEnvelope) => void | Promise<void>,
	): () => void {
		let list = this.subscribers.get(topic);
		if (!list) {
			list = [];
			this.subscribers.set(topic, list);
		}
		const entry = { handler, removed: false };
		list.push(entry);
		return () => {
			entry.removed = true;
			const current = this.subscribers.get(topic);
			if (current) {
				const idx = current.indexOf(entry);
				if (idx !== -1) {
					current.splice(idx, 1);
				}
				if (current.length === 0) {
					this.subscribers.delete(topic);
				}
			}
		};
	}

	destroy(): void {
		// Stub for interface compliance
		this.subscribers.clear();
	}

	getActiveCorrelationId(): string | undefined {
		return undefined;
	}
}
