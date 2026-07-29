/**
 * FR-HELIOS-065: Audit Export Compliance Tests
 * Verifies: FR-AUD-008 (Export with redaction), FR-SEC-005 (Redaction at sink boundary)
 */
import { describe, expect, test } from "bun:test";
import { InMemoryAuditSink } from "../../../src/audit/sink";

describe("audit export compliance", () => {
  test("exports required correlation fields", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append({
      recorded_at: "2026-02-27T00:00:00.000Z",
      sequence: 3,
      outcome: "accepted",
      reason: null,
      envelope: {
        id: "evt-export-1",
        type: "event",
        ts: "2026-02-27T00:00:00.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        session_id: "session-1",
        terminal_id: "terminal-1",
        correlation_id: "corr-1",
        topic: "terminal.output",
        payload: { chunk: "ok" },
      },
    });

    const rows = await sink.exportRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.envelope_id).toBe("evt-export-1");
    expect(rows[0]?.workspace_id).toBe("ws-1");
    expect(rows[0]?.lane_id).toBe("lane-1");
    expect(rows[0]?.session_id).toBe("session-1");
    expect(rows[0]?.terminal_id).toBe("terminal-1");
    expect(rows[0]?.correlation_id).toBe("corr-1");
    expect(rows[0]?.method_or_topic).toBe("terminal.output");
  });

  test("redacts sensitive fields recursively", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append({
      recorded_at: "2026-02-27T00:00:00.000Z",
      sequence: 4,
      outcome: "accepted",
      reason: null,
      envelope: {
        id: "evt-export-2",
        type: "event",
        ts: "2026-02-27T00:00:00.000Z",
        topic: "session.attached",
        payload: {
          authorization: "Bearer secret-value",
          nested: { token: "abc123", safe: "value" },
        },
      },
    });

    const rows = await sink.exportRecords();
    const envelope = rows[0]?.envelope as Record<string, unknown>;
    const payload = envelope.payload as Record<string, unknown>;
    expect(payload.authorization).toBe("[REDACTED]");
    expect((payload.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((payload.nested as Record<string, unknown>).safe).toBe("value");
  });
});
