import type { AuditEvent } from "./event";

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

/**
 * Storage backend interface for persisting audit events.
 * Implemented by WP02 (SQLite storage).
 */
export interface AuditStorage {
	persist(events: AuditEvent[]): Promise<void>;
}

/**
 * Append-only sink for audit events.
 * Never blocks, never drops events, guarantees delivery.
 */
export interface AuditSink {
	write(event: AuditEvent): Promise<void>;
	flush(): Promise<void>;
	getBufferedCount(): number;
	getMetrics(): AuditSinkMetrics;
}

export interface AuditRecord {
	recorded_at: string;
	sequence: number;
	outcome: "accepted" | "rejected";
	reason: string | null;
	envelope: Record<string, unknown>;
}

export interface AuditExportRecord extends AuditRecord {
	envelope_id?: string;
	workspace_id?: string;
	lane_id?: string;
	session_id?: string;
	terminal_id?: string;
	correlation_id?: string;
	method_or_topic?: string;
}

export class NoOpAuditStorage implements AuditStorage {
	async persist(_events: AuditEvent[]): Promise<void> {}
}
