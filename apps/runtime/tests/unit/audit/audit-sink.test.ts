/**
 * Audit sink and helper surface coverage.
 *
 * Drives every public path of `in-memory-audit-sink.ts` and `sink-helpers.ts`
 * so the coverage gate has evidence the audit subsystem's in-memory tier and
 * export/redaction helpers actually run.
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { describe, expect, it } from "bun:test";
import type { AuditEvent } from "../../../src/audit/event";
import { InMemoryAuditSink } from "../../../src/audit/in-memory-audit-sink.js";
import type { AuditRecord } from "../../../src/audit/sink-types";

function makeEvent(
	topic: string,
	payload: Record<string, unknown> = {},
): AuditEvent {
	return {
		id: `evt-${Math.random().toString(36).slice(2, 8)}`,
		type: "event",
		ts: new Date().toISOString(),
		topic,
		payload,
	} as unknown as AuditEvent;
}

function makeRecord(
	recorded_at: string,
	envelope: Record<string, unknown>,
): AuditRecord {
	return {
		recorded_at,
		sequence: 1,
		outcome: "accepted",
		reason: null,
		envelope,
	};
}

describe("InMemoryAuditSink", () => {
	it("append() and write() store records and bump metrics", async () => {
		const sink = new InMemoryAuditSink();
		await sink.append({
			recorded_at: new Date().toISOString(),
			sequence: 1,
			outcome: "accepted",
			reason: null,
			envelope: { topic: "test" },
		});
		await sink.write(makeEvent("audit.event"));
		expect(sink.getRecordCount()).toBe(2);
		expect(sink.getBufferedCount()).toBe(2);
		const metrics = sink.getMetrics();
		expect(metrics.totalEventsWritten).toBe(2);
		expect(metrics.bufferHighWaterMark).toBeGreaterThanOrEqual(2);
	});

	it("flush() is a no-op and does not throw", async () => {
		const sink = new InMemoryAuditSink();
		await expect(sink.flush()).resolves.toBeUndefined();
	});

	it("clear() empties the buffer but preserves counters", async () => {
		const sink = new InMemoryAuditSink();
		await sink.write(makeEvent("audit.event"));
		sink.clear();
		expect(sink.getRecordCount()).toBe(0);
		const beforeClear = sink.getMetrics().totalEventsWritten;
		await sink.write(makeEvent("audit.event"));
		expect(sink.getMetrics().totalEventsWritten).toBeGreaterThan(beforeClear);
	});

	it("getRecords() returns a snapshot copy", async () => {
		const sink = new InMemoryAuditSink();
		await sink.write(makeEvent("audit.event"));
		const snapshot = sink.getRecords();
		sink.clear();
		expect(snapshot).toHaveLength(1);
	});

	it("exportRecords() flattens envelopes and applies redaction", async () => {
		const sink = new InMemoryAuditSink();
		await sink.write(
			makeEvent("audit.command", {
				authorization: "Bearer abc",
				api_key: "sk-12345",
				nested: { token: "secret", password: "p" },
			}),
		);
		const [exported] = await sink.exportRecords();
		expect(exported.envelope).toMatchObject({
			payload: {
				authorization: "[REDACTED]",
				api_key: "[REDACTED]",
				nested: { token: "[REDACTED]", password: "[REDACTED]" },
			},
		});
		expect(exported.method_or_topic).toBe("audit.command");
	});

	it("exportRecords() exposes envelope_id, lane_id, session_id, etc.", async () => {
		const sink = new InMemoryAuditSink();
		await sink.append({
			recorded_at: new Date().toISOString(),
			sequence: 1,
			outcome: "accepted",
			reason: null,
			envelope: {
				id: "evt-id-1",
				topic: "audit.event",
				workspace_id: "ws-1",
				lane_id: "lane-1",
				session_id: "sess-1",
				terminal_id: "term-1",
				correlation_id: "corr-1",
			},
		});
		const [exported] = await sink.exportRecords();
		expect(exported.envelope_id).toBe("evt-id-1");
		expect(exported.workspace_id).toBe("ws-1");
		expect(exported.lane_id).toBe("lane-1");
		expect(exported.session_id).toBe("sess-1");
		expect(exported.terminal_id).toBe("term-1");
		expect(exported.correlation_id).toBe("corr-1");
	});

	it("exportRecords() preserves bearer tokens in non-string contexts without redaction crash", async () => {
		const sink = new InMemoryAuditSink();
		await sink.write(
			makeEvent("audit.event", {
				list: ["Bearer literal", "ok"],
				arr: [1, "Bearer inline"],
			}),
		);
		const [exported] = await sink.exportRecords();
		expect(exported.envelope).toBeDefined();
	});

	it("exportRecords() surfaces method_or_topic when envelope uses method", async () => {
		const sink = new InMemoryAuditSink();
		await sink.append({
			recorded_at: new Date().toISOString(),
			sequence: 1,
			outcome: "accepted",
			reason: null,
			envelope: {
				id: "method-1",
				method: "commands.execute",
				workspace_id: "ws-method",
			},
		});
		const [exported] = await sink.exportRecords();
		expect(exported.method_or_topic).toBe("commands.execute");
		expect(exported.workspace_id).toBe("ws-method");
		expect(exported.envelope_id).toBe("method-1");
	});

	it("enforceRetention() deletes records past the cutoff and emits a marker", async () => {
		const sink = new InMemoryAuditSink({ retention_days: 1 });
		const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
		const recent = new Date().toISOString();
		await sink.append(makeRecord(old, { topic: "audit.event" }));
		await sink.append(makeRecord(recent, { topic: "audit.event" }));

		const { deleted_count } = await sink.enforceRetention();
		expect(deleted_count).toBe(1);
		expect(sink.getRecordCount()).toBe(2); // 1 retained + 1 marker
		const last = sink.getRecords().at(-1);
		expect(last?.envelope).toMatchObject({ topic: "audit.retention.deleted" });
	});

	it("enforceRetention() exempts audit.retention.deleted records from deletion", async () => {
		const sink = new InMemoryAuditSink({ retention_days: 1 });
		const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		await sink.append(makeRecord(old, { topic: "audit.retention.deleted" }));
		await sink.append(makeRecord(old, { topic: "audit.event" }));

		const { deleted_count } = await sink.enforceRetention();
		expect(deleted_count).toBe(1);
	});

	it("getMetrics() returns a copy so callers can't mutate the sink's state", async () => {
		const sink = new InMemoryAuditSink();
		await sink.write(makeEvent("audit.event"));
		const metrics = sink.getMetrics();
		metrics.totalEventsWritten = 9999;
		expect(sink.getMetrics().totalEventsWritten).toBe(1);
	});
});
