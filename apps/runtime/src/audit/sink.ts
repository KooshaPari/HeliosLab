import type { AuditEvent } from "./event";
import { AuditRingBuffer } from "./ring-buffer";
import type { AuditFilter } from "./ring-buffer";
import type { LocalBusEnvelope } from "../protocol/types.js";
import {
  type AuditOutcome,
  type AuditRecord,
  type AuditExportRecord,
  type RetentionPolicyConfig,
  type AuditBundle,
  type AuditSinkMetrics,
  toExportRecord,
  shouldRetainRecord,
  buildDeletionProofRecord,
  sanitizeEnvelopeSimple,
  sanitize,
  getString,
  inferType,
  getRecordPayload,
} from "./sink-helpers.js";

export type {
  AuditOutcome,
  AuditRecord,
  AuditExportRecord,
  RetentionPolicyConfig,
  AuditBundle,
  AuditSinkMetrics,
} from "./sink-helpers.js";

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

/**
 * Default implementation of AuditSink with ring buffer and SQLite persistence.
 * Integrates WP01 (sink) with WP02 (ring buffer and storage).
 */
export class DefaultAuditSink implements AuditSink {
  private buffer: AuditEvent[] = [];
  private ringBuffer: AuditRingBuffer;
  private storage: AuditStorage;
  readonly records: AuditRecord[] = [];
  retentionPolicy: RetentionPolicyConfig = {
    retention_days: 90,
    redacted_fields: [],
    exempt_topics: [],
  };
  private readonly MAX_BUFFER_SIZE = 10_000;
  private readonly RETRY_BACKOFF_MS = 100;
  private readonly MAX_RETRIES = 5;
  private readonly FLUSH_INTERVAL_MS = 10_000;

  private metrics: AuditSinkMetrics = {
    totalEventsWritten: 0,
    bufferHighWaterMark: 0,
    persistenceFailures: 0,
    retryCount: 0,
    eventsOverflowed: 0,
    sqliteWriteFailures: 0,
    sqliteRetryCount: 0,
  };

  private persistenceChain: Promise<void> = Promise.resolve();
  private flushTimer: number | null = null;
  private overflowQueue: AuditEvent[] = [];

  constructor(
    storageOrConfig?: AuditStorage | Record<string, unknown>,
    ringBufferCapacity: number = 10_000
  ) {
    if (storageOrConfig && typeof (storageOrConfig as AuditStorage).persist === "function") {
      this.storage = storageOrConfig as AuditStorage;
    } else {
      this.storage = new NoOpAuditStorage();
      if (
        storageOrConfig &&
        typeof storageOrConfig === "object" &&
        "retention_days" in storageOrConfig
      ) {
        this.retentionPolicy = {
          ...this.retentionPolicy,
          retention_days: storageOrConfig.retention_days as number,
        };
      }
    }
    this.ringBuffer = new AuditRingBuffer(ringBufferCapacity);
    this.startPeriodicFlush();
  }

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  getRecords(): AuditRecord[] {
    return this.records;
  }

  async write(event: AuditEvent): Promise<void> {
    this.metrics.totalEventsWritten++;
    const evicted = this.ringBuffer.push(event);

    if (evicted) {
      // If the evicted event is still in the worker buffer, remove it and persist via overflow path.
      const idx = this.buffer.findIndex(e => e.id === evicted.id);
      if (idx >= 0) {
        this.buffer.splice(idx, 1);
        this.metrics.eventsOverflowed!++;
        this.overflowQueue.push(evicted);

        this.persistOverflow().catch(err => {
          console.error("[AuditSink] Overflow persistence failed:", err);
        });
      } else {
        // Event is already persisted; skip duplicate overflow persist.
      }
    }

    this.buffer.push(event);

    if (this.buffer.length > this.metrics.bufferHighWaterMark) {
      this.metrics.bufferHighWaterMark = this.buffer.length;
    }

    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.persistWithRetry().catch(err => {
        console.error("[AuditSink] Persistence failed, events retained in buffer:", err);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 && this.overflowQueue.length === 0) {
      return;
    }

    let retries = 0;
    while (
      (this.buffer.length > 0 || this.overflowQueue.length > 0) &&
      retries < this.MAX_RETRIES
    ) {
      try {
        if (this.overflowQueue.length > 0) {
          await this.persistOverflow();
        }
        if (this.buffer.length > 0) {
          await this.persistWithRetry();
        }
        break;
      } catch {
        retries++;
        if (retries >= this.MAX_RETRIES) {
          throw new Error(`[AuditSink] Failed to flush after ${this.MAX_RETRIES} retries: ${err}`);
        }
        await new Promise(resolve => setTimeout(resolve, this.RETRY_BACKOFF_MS * retries));
      }
    }
  }

  getBufferedCount(): number {
    return this.buffer.length;
  }

  getMetrics(): AuditSinkMetrics {
    return { ...this.metrics };
  }

  private enqueuePersistenceTask(task: () => Promise<void>): Promise<void> {
    const chained = this.persistenceChain.then(() => task());
    this.persistenceChain = chained.catch(() => {
      // swallow to keep chain alive for future tasks, errors are handled separately
    });
    return chained;
  }

  private async persistWithRetry(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    await this.enqueuePersistenceTask(async () => {
      // Snapshot current buffer for persistence, and allow new writes to accumulate concurrently.
      const eventsToPersist = [...this.buffer];

      let retries = 0;
      while (retries < this.MAX_RETRIES) {
        try {
          await this.storage.persist(eventsToPersist);
          // Only clear buffer after successful commit
          this.buffer = this.buffer.slice(eventsToPersist.length);
          return;
        } catch {
          this.metrics.persistenceFailures++;
          this.metrics.retryCount++;
          retries++;
          if (retries < this.MAX_RETRIES) {
            await new Promise(resolve =>
              setTimeout(resolve, this.RETRY_BACKOFF_MS * Math.pow(2, retries - 1))
            );
          } else {
            // Put persisted events back into buffer to avoid data loss; preserve new events that may have been added.
            this.buffer = [...eventsToPersist, ...this.buffer];
            throw err;
          }
        }
      }
    });
  }

  private async persistOverflow(): Promise<void> {
    if (this.overflowQueue.length === 0) {
      return;
    }

    await this.enqueuePersistenceTask(async () => {
      let retries = 0;

      while (retries < this.MAX_RETRIES && this.overflowQueue.length > 0) {
        try {
          const eventsToPersist = [...this.overflowQueue];
          await this.storage.persist(eventsToPersist);

          this.overflowQueue.splice(0, eventsToPersist.length);

          retries = 0;
        } catch {
          this.metrics.sqliteWriteFailures!++;
          this.metrics.sqliteRetryCount!++;
          retries++;

          if (retries >= this.MAX_RETRIES) {
            throw err;
          }

          await new Promise(resolve =>
            setTimeout(resolve, this.RETRY_BACKOFF_MS * Math.pow(2, retries - 1))
          );
        }
      }
    });
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0 || this.overflowQueue.length > 0) {
        this.persistWithRetry().catch(err => {
          console.error("[AuditSink] Periodic flush failed:", err);
        });
      }
    }, this.FLUSH_INTERVAL_MS) as unknown as number;
  }

  private stopPeriodicFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  destroy(): void {
    this.stopPeriodicFlush();
  }

  async enforceRetention(now: Date = new Date()): Promise<{ deleted_count: number }> {
    const keep: AuditRecord[] = [];
    const expired: AuditRecord[] = [];
    for (const record of this.records) {
      if (shouldRetainRecord(record, this.retentionPolicy, now)) {
        keep.push(record);
      } else {
        expired.push(record);
      }
    }

    this.records.length = 0;
    this.records.push(...keep);

    if (expired.length > 0) {
      this.records.push(buildDeletionProofRecord(expired.length, now));
    }

    return { deleted_count: expired.length };
  }

  async exportRecords(): Promise<AuditExportRecord[]> {
    return this.records.map(record => toExportRecord(record, this.retentionPolicy));
  }
}

/**
 * No-op storage for testing and development.
 * Events are buffered but never persisted.
 */
export class NoOpAuditStorage implements AuditStorage {
  readonly records: AuditRecord[] = [];

  async persist(_events: AuditEvent[]): Promise<void> {
    // Do nothing; events are discarded
  }

  query(filter: AuditFilter = {}): AuditRecord[] {
    return this.records.filter(record => {
      if (filter.workspaceId && record.workspace_id !== filter.workspaceId) {
        return false;
      }
      if (filter.laneId && record.lane_id !== filter.laneId) {
        return false;
      }
      if (filter.sessionId && record.session_id !== filter.sessionId) {
        return false;
      }
      if (filter.correlationId && record.correlation_id !== filter.correlationId) {
        return false;
      }
      return true;
    });
  }

  exportBundle(filter: AuditFilter = {}): AuditBundle {
    const records = this.query(filter);
    return {
      generated_at: new Date().toISOString(),
      filters: { ...filter },
      count: records.length,
      records,
    };
  }

  private enrichRecord(record: {
    recorded_at: string;
    sequence: number | null;
    outcome: AuditOutcome;
    reason: string | null;
    envelope: LocalBusEnvelope | Record<string, unknown>;
  }): AuditRecord {
    const envelope = sanitizeEnvelopeSimple(record.envelope);
    const payload = sanitize(getRecordPayload(envelope));

    return {
      id: `${record.recorded_at}:${this.records.length + 1}`,
      recorded_at: record.recorded_at,
      sequence: record.sequence,
      outcome: record.outcome,
      reason: record.reason,
      envelope,
      action: getString(envelope.topic) ?? getString(envelope.method) ?? "audit.recorded",
      type: inferType(envelope),
      status: record.outcome === "accepted" ? "ok" : "error",
      workspace_id: getString(envelope.workspace_id),
      lane_id:
        getString(envelope.lane_id) ??
        getString((envelope.payload as Record<string, unknown>)?.lane_id),
      session_id:
        getString(envelope.session_id) ??
        getString((envelope.payload as Record<string, unknown>)?.session_id),
      terminal_id:
        getString(envelope.terminal_id) ??
        getString((envelope.payload as Record<string, unknown>)?.terminal_id),
      correlation_id: getString(envelope.correlation_id),
      error_code: getString((envelope.error as Record<string, unknown>)?.code),
      payload,
    };
  }
}

/** @deprecated Use DefaultAuditSink. Alias retained for backward compatibility. */
export { DefaultAuditSink as InMemoryAuditSink };
