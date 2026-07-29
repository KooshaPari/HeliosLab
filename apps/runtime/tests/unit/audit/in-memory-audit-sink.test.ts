import { describe, expect, it } from "bun:test";
import { InMemoryAuditSink } from "../../../src/audit/in-memory-audit-sink";

describe("InMemoryAuditSink retention", () => {
  it("should preserve deletion-proof records while purging expired records", async () => {
    const sink = new InMemoryAuditSink({ retention_days: 1 });
    const recordedAt = "2020-01-01T00:00:00.000Z";

    await sink.append({
      recorded_at: recordedAt,
      sequence: 1,
      outcome: "accepted",
      reason: null,
      envelope: { topic: "audit.retention.deleted" },
    });
    await sink.append({
      recorded_at: recordedAt,
      sequence: 2,
      outcome: "accepted",
      reason: null,
      envelope: { topic: "session.created" },
    });

    const result = await sink.enforceRetention(new Date("2026-01-01T00:00:00.000Z"));

    expect(result.deleted_count).toBe(1);
    expect(sink.getRecords()).toHaveLength(2);
    expect(
      sink.getRecords().every(record => record.envelope.topic === "audit.retention.deleted")
    ).toBe(true);
  });
});
