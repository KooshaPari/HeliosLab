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

/** Handler invoked for every accepted event published on a subscribed topic. */
type Subscriber = (evt: EventEnvelope) => void | Promise<void>;

// ---------------------------------------------------------------------------
// InMemoryLocalBus — protocol lifecycle implementation
// ---------------------------------------------------------------------------

export class InMemoryLocalBus implements LocalBus {
	private readonly eventLog: LocalBusEnvelope[] = [];
	private readonly auditLog: AuditRecord[] = [];
	private readonly metricsRecorder: MetricsRecorder = new MetricsRecorder();
	private state: BusState = { session: "detached" };
	private readonly lifecycleProgress: Map<string, Set<string>> = new Map();
	private readonly subscribers = new Map<string, Set<Subscriber>>();
	private rendererEngine: "ghostty" | "rio" = "ghostty";

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
				await this.dispatch(event);
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
		await this.dispatch(event);
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
		let handlers = this.subscribers.get(topic);
		if (!handlers) {
			handlers = new Set();
			this.subscribers.set(topic, handlers);
		}
		handlers.add(handler);
		return () => {
			const current = this.subscribers.get(topic);
			if (!current) return;
			current.delete(handler);
			if (current.size === 0) {
				this.subscribers.delete(topic);
			}
		};
	}

	/**
	 * Deliver an accepted event to every handler subscribed to its topic.
	 *
	 * Delivery is awaited so a publisher observes deterministic ordering, and
	 * per-handler failures are swallowed so a failing subscriber cannot break
	 * the lifecycle transition that published the event.
	 */
	private async dispatch(event: LocalBusEnvelope): Promise<void> {
		const handlers = this.subscribers.get(event.topic ?? "");
		if (!handlers || handlers.size === 0) return;
		// Snapshot so a handler that unsubscribes mid-delivery does not affect
		// the current fan-out.
		for (const handler of [...handlers]) {
			try {
				await handler(event as EventEnvelope);
			} catch {
				// Subscriber isolation: a failing subscriber is not fatal.
			}
		}
	}

	destroy(): void {
		// Stub for interface compliance
	}

	getActiveCorrelationId(): string | undefined {
		return undefined;
	}
}
