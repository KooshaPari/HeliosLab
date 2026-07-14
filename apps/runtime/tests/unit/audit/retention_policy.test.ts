/**
 * FR-HELIOS-066: Retention Policy Tests
 * Verifies: FR-AUD-009 (Retention TTL enforcement), FR-AUD-011 (Deletion proof)
 */
import { describe, expect, test } from "bun:test";
import { createRetentionPolicyConfig } from "../../../src/config/retention";
import { InMemoryAuditSink } from "../../../src/audit/sink";

describe("retention policy", () => {
  test("enforces minimum retention days", () => {
    expect(() => createRetentionPolicyConfig({ retention_days: 7 })).toThrow(
      "retention_days must be an integer >= 30"
    );
  });

  test("expires records beyond ttl and emits deletion proof", async () => {
    const sink = new InMemoryAuditSink({ retention_days: 30 });
    await sink.append({
      recorded_at: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      outcome: "accepted",
      reason: null,
      envelope: {
        id: "evt-old",
        type: "event",
        ts: "2026-01-01T00:00:00.000Z",
        topic: "session.attached",
        payload: {},
      },
    });
    await sink.append({
      recorded_at: "2026-02-20T00:00:00.000Z",
      sequence: 2,
      outcome: "accepted",
      reason: null,
      envelope: {
        id: "evt-new",
        type: "event",
        ts: "2026-02-20T00:00:00.000Z",
        topic: "session.attached",
        payload: {},
      },
    });

    const result = await sink.enforceRetention(new Date("2026-02-27T00:00:00.000Z"));
    expect(result.deleted_count).toBe(1);

    const records = sink.getRecords();
    expect(records).toHaveLength(2);
    const proof = records.find(record => {
      const envelope = record.envelope as Record<string, unknown>;
      return envelope.topic === "audit.retention.deleted";
    });
    expect(proof).toBeDefined();
  });
});
