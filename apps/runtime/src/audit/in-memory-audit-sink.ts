import type { AuditEvent } from "./event";
import type { AuditExportRecord, AuditRecord, AuditSink, AuditSinkMetrics } from "./sink-types";

function createMetrics(): AuditSinkMetrics {
  return {
    totalEventsWritten: 0,
    bufferHighWaterMark: 0,
    persistenceFailures: 0,
    retryCount: 0,
  };
}

export class InMemoryAuditSink implements AuditSink {
  private records: AuditRecord[] = [];
  private metrics: AuditSinkMetrics = createMetrics();
  private retentionDays: number;

  constructor(options: { retention_days?: number } = {}) {
    this.retentionDays = options.retention_days ?? 30;
  }

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
    this.metrics.totalEventsWritten++;
    if (this.records.length > this.metrics.bufferHighWaterMark) {
      this.metrics.bufferHighWaterMark = this.records.length;
    }
  }

  async write(event: AuditEvent): Promise<void> {
    await this.append({
      recorded_at: new Date().toISOString(),
      sequence: this.records.length + 1,
      outcome: "accepted",
      reason: null,
      envelope: event as unknown as Record<string, unknown>,
    });
  }

  async flush(): Promise<void> {}

  getBufferedCount(): number {
    return this.records.length;
  }

  getMetrics(): AuditSinkMetrics {
    return { ...this.metrics };
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }

  async exportRecords(): Promise<AuditExportRecord[]> {
    return this.records.map(record => this.flattenRecord(record, true));
  }

  clear(): void {
    this.records = [];
  }

  getRecordCount(): number {
    return this.records.length;
  }

  async enforceRetention(now: Date = new Date()): Promise<{ deleted_count: number }> {
    const originalCount = this.records.length;
    const cutoffMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const retained = this.records.filter(record => {
      const envelope = record.envelope as Record<string, unknown>;
      const topic = envelope.topic as string | undefined;
      if (topic === "audit.retention.deleted") {
        return true;
      }

      const timestamp = Date.parse(record.recorded_at);
      return now.getTime() - timestamp <= cutoffMs;
    });

    const deletedCount = originalCount - retained.length;
    if (deletedCount > 0) {
      retained.push({
        recorded_at: now.toISOString(),
        sequence: retained.length + 1,
        outcome: "accepted",
        reason: null,
        envelope: {
          id: `audit-retention-${now.getTime()}`,
          type: "event",
          ts: now.toISOString(),
          topic: "audit.retention.deleted",
          payload: { deleted_count: deletedCount },
        },
      });
    }

    this.records = retained;

    return { deleted_count: deletedCount };
  }

  private flattenRecord(record: AuditRecord, redactPayload: boolean): AuditExportRecord {
    const envelopeRecord = record.envelope as Record<string, unknown>;
    const envelope = redactPayload ? this.redactEnvelope(envelopeRecord) : { ...envelopeRecord };
    const methodOrTopic = (envelope.method ?? envelope.topic) as string | undefined;

    return {
      ...record,
      envelope,
      envelope_id: typeof envelope.id === "string" ? envelope.id : undefined,
      workspace_id: typeof envelope.workspace_id === "string" ? envelope.workspace_id : undefined,
      lane_id: typeof envelope.lane_id === "string" ? envelope.lane_id : undefined,
      session_id: typeof envelope.session_id === "string" ? envelope.session_id : undefined,
      terminal_id: typeof envelope.terminal_id === "string" ? envelope.terminal_id : undefined,
      correlation_id:
        typeof envelope.correlation_id === "string" ? envelope.correlation_id : undefined,
      method_or_topic: methodOrTopic,
    };
  }

  private redactEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
    return this.redactValue(envelope) as Record<string, unknown>;
  }

  private redactValue(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.redactValue(item));
    }

    if (!value || typeof value !== "object") {
      if (typeof value === "string" && this.shouldRedact(key, value)) {
        return "[REDACTED]";
      }
      return value;
    }

    const entries = Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => {
        if (typeof entryValue === "string" && this.shouldRedact(entryKey, entryValue)) {
          return [entryKey, "[REDACTED]"];
        }
        return [entryKey, this.redactValue(entryValue, entryKey)];
      }
    );

    return Object.fromEntries(entries);
  }

  private shouldRedact(key: string | undefined, value: string): boolean {
    const normalizedKey = (key ?? "").toLowerCase();
    return (
      normalizedKey.includes("authorization") ||
      normalizedKey.includes("api_key") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("password") ||
      value.toLowerCase().includes("bearer ")
    );
  }
}
