// Audit sink types and helper functions — extracted from sink.ts for static analysis compliance.

import type { LocalBusEnvelope } from "../protocol/types.js";

export type AuditOutcome = "accepted" | "rejected";

export interface AuditRecord {
	id?: string;
	recorded_at: string;
	sequence: number | null;
	outcome: AuditOutcome;
	reason: string | null;
	envelope: LocalBusEnvelope | Record<string, unknown>;
	action?: string;
	type?: "command" | "response" | "event" | "system";
	status?: "ok" | "error";
	workspace_id?: string | null;
	lane_id?: string | null;
	session_id?: string | null;
	terminal_id?: string | null;
	correlation_id?: string | null;
	error_code?: string | null;
	payload?: unknown;
}

export interface AuditExportRecord {
	recorded_at: string;
	sequence: number | null;
	outcome: AuditOutcome;
	reason: string | null;
	envelope_id: string;
	envelope_type: string;
	correlation_id: string | null;
	workspace_id: string | null;
	lane_id: string | null;
	session_id: string | null;
	terminal_id: string | null;
	method_or_topic: string | null;
	envelope: LocalBusEnvelope | Record<string, unknown>;
}

export interface RetentionPolicyConfig {
	retention_days: number;
	redacted_fields: string[];
	exempt_topics: string[];
}

export interface AuditBundle {
	generated_at: string;
	filters: Record<string, unknown>;
	count: number;
	records: AuditRecord[];
}

/**
 * Extended metrics including ring buffer and overflow tracking.
 */
export interface AuditSinkMetrics {
	totalEventsWritten: number;
	bufferHighWaterMark: number;
	persistenceFailures: number;
	retryCount: number;
	eventsOverflowed?: number;
	sqliteWriteFailures?: number;
	sqliteRetryCount?: number;
}

export function toExportRecord(
	record: AuditRecord,
	policy: RetentionPolicyConfig,
): AuditExportRecord {
	const envelope = sanitizeEnvelope(record.envelope, policy.redacted_fields);
	const envelopeObject = envelope as Record<string, unknown>;
	const methodOrTopic =
		readString(envelopeObject.method) ??
		readString(envelopeObject.topic) ??
		null;

	return {
		recorded_at: record.recorded_at,
		sequence: record.sequence,
		outcome: record.outcome,
		reason: record.reason,
		envelope_id:
			readString(envelopeObject.envelope_id) ??
			readString(envelopeObject.id) ??
			"unknown",
		envelope_type: readString(envelopeObject.type) ?? "unknown",
		correlation_id: readString(envelopeObject.correlation_id) ?? null,
		workspace_id: readString(envelopeObject.workspace_id) ?? null,
		lane_id: readString(envelopeObject.lane_id) ?? null,
		session_id: readString(envelopeObject.session_id) ?? null,
		terminal_id: readString(envelopeObject.terminal_id) ?? null,
		method_or_topic: methodOrTopic,
		envelope,
	};
}

export function sanitizeEnvelope(
	envelope: LocalBusEnvelope | Record<string, unknown>,
	redactedFields: string[],
): LocalBusEnvelope | Record<string, unknown> {
	const redactionSet = new Set(
		redactedFields.map((field) => field.toLowerCase()),
	);
	return deepRedact(envelope, redactionSet) as
		| LocalBusEnvelope
		| Record<string, unknown>;
}

function deepRedact(
	value: unknown,
	redactionSet: ReadonlySet<string>,
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => deepRedact(item, redactionSet));
	}
	if (value && typeof value === "object") {
		const input = value as Record<string, unknown>;
		const output: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(input)) {
			if (redactionSet.has(key.toLowerCase()) || isSensitiveKey(key)) {
				output[key] = "[REDACTED]";
			} else {
				output[key] = deepRedact(nested, redactionSet);
			}
		}
		return output;
	}
	return value;
}

export function shouldRetainRecord(
	record: AuditRecord,
	policy: RetentionPolicyConfig,
	now: Date,
): boolean {
	const topic = readEnvelopeTopic(record.envelope);
	if (topic && policy.exempt_topics.includes(topic)) {
		return true;
	}

	const recordedAtMs = Date.parse(record.recorded_at);
	if (Number.isNaN(recordedAtMs)) {
		return true;
	}

	const ttlMs = policy.retention_days * 24 * 60 * 60 * 1000;
	return now.getTime() - recordedAtMs <= ttlMs;
}

function readEnvelopeTopic(
	envelope: LocalBusEnvelope | Record<string, unknown>,
): string | null {
	if (!envelope || typeof envelope !== "object") {
		return null;
	}
	const value = (envelope as Record<string, unknown>).topic;
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildDeletionProofRecord(
	expiredCount: number,
	now: Date,
): AuditRecord {
	return {
		recorded_at: now.toISOString(),
		sequence: null,
		outcome: "accepted",
		reason: "retention_enforced",
		envelope: {
			id: `audit.retention.deleted:${now.getTime()}`,
			type: "event",
			ts: now.toISOString(),
			topic: "audit.retention.deleted",
			payload: {
				deleted_count: expiredCount,
			},
		},
	};
}

export function readString(input: unknown): string | null {
	return typeof input === "string" && input.length > 0 ? input : null;
}

export function isSensitiveKey(key: string): boolean {
	return /(token|secret|password|api[_-]?key|authorization|bearer)/i.test(key);
}

export function inferType(
	envelope: Record<string, unknown>,
): AuditRecord["type"] {
	const value = envelope.type;
	if (value === "command" || value === "response" || value === "event") {
		return value;
	}
	return "system";
}

export function getRecordPayload(envelope: Record<string, unknown>): unknown {
	return envelope.payload ?? envelope.result ?? envelope.error ?? {};
}

export function sanitizeEnvelopeSimple(
	envelope: LocalBusEnvelope | Record<string, unknown>,
): Record<string, unknown> {
	return sanitize(envelope) as Record<string, unknown>;
}

export function sanitize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitize(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => {
				if (isSensitiveKey(key)) {
					return [key, "[REDACTED]"];
				}
				return [key, sanitize(item)];
			}),
		);
	}
	return value;
}

export function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
