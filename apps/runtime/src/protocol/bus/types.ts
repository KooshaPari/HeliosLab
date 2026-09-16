import type { MethodHandler } from "../methods.js";
import type { LocalBusEnvelope } from "../types.js";

// ---------------------------------------------------------------------------
// LocalBus Interface
// ---------------------------------------------------------------------------

export interface LocalBus {
	publish(event: LocalBusEnvelope): Promise<void>;
	request(command: LocalBusEnvelope): Promise<LocalBusEnvelope>;
	registerMethod(method: string, handler: MethodHandler): void;
	send(envelope: unknown): Promise<ResponseEnvelope>;
	subscribe(
		topic: string,
		handler: (evt: EventEnvelope) => void | Promise<void>,
	): () => void;
	destroy(): void;
	getActiveCorrelationId(): string | undefined;
}

// ---------------------------------------------------------------------------
// Audit and Metrics Types
// ---------------------------------------------------------------------------

export type AuditRecord = {
	envelope: LocalBusEnvelope;
	outcome: "accepted" | "rejected";
	error?: string;
};

export type MetricSample = {
	metric: string;
	value: number;
	tags?: Record<string, string>;
};

export type MetricSummary = {
	metric: string;
	count: number;
	latest?: number;
	p95?: number;
	p99?: number;
	min?: number;
	max?: number;
};

export type MetricsReport = {
	summaries: MetricSummary[];
	samples?: MetricSample[];
};

// ---------------------------------------------------------------------------
// Bus State Types
// ---------------------------------------------------------------------------

export type BusState = {
	session: "attached" | "detached";
	terminal?: "active" | "inactive" | "throttled";
};

// ---------------------------------------------------------------------------
// CommandBus Types
// ---------------------------------------------------------------------------

export type CommandBusOptions = {
	maxDepth?: number;
};

// Envelope types (compatible with protocol envelopes)
export interface CommandEnvelope {
	id: string;
	type: "command";
	method: string;
	correlation_id: string;
	payload: Record<string, unknown>;
	workspace_id?: string;
	lane_id?: string;
	session_id?: string;
	terminal_id?: string;
}

export interface EventEnvelope {
	type: "event";
	topic: string;
	correlation_id?: string;
	sequence?: number;
	payload?: Record<string, unknown>;
	workspace_id?: string;
	lane_id?: string;
	session_id?: string;
	terminal_id?: string;
}

export interface ResponseEnvelope {
	id: string;
	type: "response";
	ts: string;
	status: "ok" | "error";
	method?: string;
	correlation_id?: string;
	result?: Record<string, unknown>;
	error?: {
		code: string;
		message: string;
		retryable?: boolean;
	};
	payload?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// LocalBusEnvelopeWithSequence Type
// ---------------------------------------------------------------------------

export type LocalBusEnvelopeWithSequence = LocalBusEnvelope & {
	sequence?: number;
};
