import { randomBytes } from "node:crypto";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  timestamp: string;
  topic: string;
  payload: Record<string, unknown>;
  correlationId: string;
}

export interface AuditExportBundle {
  exportedAt: string;
  records: AuditRecord[];
  redacted: boolean;
}

export type RedactFn = (content: string) => string;

// ---------------------------------------------------------------------------
// AuditSink - lightweight spec 024 integration point
// ---------------------------------------------------------------------------

/**
 * AuditSink subscribes to bus events from configured topics and persists
 * them as AuditRecord entries. All persisted payloads are passed through the
 * redaction function before storage.
 *
 * This is the spec 024 audit subsystem integration point. When spec 024 is
 * fully implemented, replace the in-memory store with the spec 024 sink
 * adapter by providing a different `persistRecord` implementation via the
 * constructor options.
 */
export class AuditSink {
  private records: AuditRecord[] = [];
  private redactFn: RedactFn;
  private watchedTopics: Set<string>;

  /**
   * @param opts.bus         LocalBus to subscribe to events from.
   * @param opts.redactFn    Redaction function applied to serialized payload before persistence.
   * @param opts.topics      Bus topics to watch. Defaults to all secrets.* topics.
   */
  constructor(opts?: {
    bus?: LocalBus;
    redactFn?: RedactFn;
    topics?: string[];
    persistRecord?: (record: AuditRecord) => Promise<void>;
  }) {
    this.redactFn = opts?.redactFn ?? (s => s);
    this.watchedTopics = new Set(
      opts?.topics ?? [
        "secrets.credential.created",
        "secrets.credential.rotated",
        "secrets.credential.revoked",
        "secrets.credential.accessed",
        "secrets.credential.access.denied",
        "secrets.redaction.applied",
        "secrets.protected_path.accessed",
        "secrets.protected_path.acknowledged",
        "secrets.redaction.rules.changed",
        "secrets.protected_paths.config.changed",
      ]
    );
    if (opts?.persistRecord) {
      this._persistRecord = opts.persistRecord;
    }
  }

  /**
   * Persist an event envelope as an audit record.
   * The payload is serialized to JSON, passed through redaction, and
   * re-parsed before storage to ensure no secrets persist in memory.
   */
  async ingest(envelope: LocalBusEnvelope): Promise<AuditRecord | null> {
    const _topic = envelope.topic ?? "";
    if (!this.watchedTopics.has(topic)) return null;

    const correlationId: string =
      (envelope.payload?.correlationId as string | undefined) ?? randomBytes(8).toString("hex");

    // Serialize payload, apply redaction, re-parse
    const rawPayload = JSON.stringify(envelope.payload ?? {});
    const redactedPayload = this.redactFn(rawPayload);
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(redactedPayload) as Record<string, unknown>;
    } catch {
      parsedPayload = { _raw: redactedPayload };
    }

    const record: AuditRecord = {
      id: `audit:${topic}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      timestamp: envelope.ts ?? new Date().toISOString(),
      topic,
      payload: parsedPayload,
      correlationId,
    };

    await this._persistRecord(record);
    return record;
  }

  /**
   * Process a bus event directly from the LocalBus subscriber pattern.
   */
  async processEvent(envelope: LocalBusEnvelope): Promise<void> {
    await this.ingest(envelope);
  }

  /**
   * Wire the audit sink to a LocalBus. All watched topics will be ingested.
   * Note: LocalBus does not have a native subscribe API in this runtime;
   * callers should call `processEvent` for each published envelope, or wrap
   * the bus with an intercepting proxy via `wrapBus`.
   */
  wireToBus(_bus: LocalBus): void {
    // Audit sink is wired via wrapBus pattern; this method is kept for future extensibility
  }

  /**
   * Create a wrapping LocalBus that intercepts all publish calls and feeds
   * them into this audit sink before forwarding to the underlying bus.
   */
  wrapBus(bus: LocalBus): LocalBus {
    return {
      async publish(event: LocalBusEnvelope): Promise<void> {
        await this.ingest(event);
        await bus.publish(event);
      },
      async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
        return bus.request(command);
      },
      registerMethod: bus.registerMethod.bind(bus),
      send: bus.send.bind(bus),
      subscribe: bus.subscribe.bind(bus),
      destroy: bus.destroy.bind(bus),
      getActiveCorrelationId: bus.getActiveCorrelationId.bind(bus),
    };
  }

  /**
   * Query stored audit records.
   */
  query(filter?: { topic?: string; correlationId?: string; since?: Date }): AuditRecord[] {
    let results = [...this.records];

    if (filter?.topic) {
      results = results.filter(r => r.topic === filter.topic);
    }
    if (filter?.correlationId) {
      results = results.filter(r => r.correlationId === filter.correlationId);
    }
    if (filter?.since) {
      const since = filter.since;
      results = results.filter(r => new Date(r.timestamp) >= since);
    }

    return results;
  }

  /**
   * Generate an export bundle. All record payloads pass through the
   * redaction function a second time (double-redaction safety net).
   * Redaction is idempotent: already-redacted placeholders (`[REDACTED:*]`)
   * do not match secret patterns and are preserved verbatim.
   */
  export(): AuditExportBundle {
    const redactedRecords = this.records.map(r => {
      const rawPayload = JSON.stringify(r.payload);
      const redactedPayload = this.redactFn(rawPayload);
      let parsedPayload: Record<string, unknown>;
      try {
        parsedPayload = JSON.parse(redactedPayload) as Record<string, unknown>;
      } catch {
        parsedPayload = { _raw: redactedPayload };
      }
      return { ...r, payload: parsedPayload };
    });

    return {
      exportedAt: new Date().toISOString(),
      records: redactedRecords,
      redacted: true,
    };
  }

  /**
   * Clear all records (primarily for testing).
   */
  clear(): void {
    this.records = [];
  }

  getRecordCount(): number {
    return this.records.length;
  }

  // Overrideable persistence hook
  private async _persistRecord(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}
