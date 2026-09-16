import { expect, test } from "bun:test";
import { InMemoryAuditSink } from "../../../src/audit/sink";

test("retention hook keeps exempt deletion-proof topic", async () => {
	const sink = new InMemoryAuditSink({ retention_days: 30 });

	await sink.append({
		recorded_at: "2026-01-01T00:00:00.000Z",
		sequence: 1,
		outcome: "accepted",
		reason: null,
		envelope: {
			id: "evt-expired",
			type: "event",
			ts: "2026-01-01T00:00:00.000Z",
			topic: "session.attached",
			payload: {},
		},
	});
	await sink.append({
		recorded_at: "2026-01-01T00:00:00.000Z",
		sequence: 2,
		outcome: "accepted",
		reason: null,
		envelope: {
			id: "evt-proof-legacy",
			type: "event",
			ts: "2026-01-01T00:00:00.000Z",
			topic: "audit.retention.deleted",
			payload: { deleted_count: 1 },
		},
	});

	await sink.enforceRetention(new Date("2026-02-27T00:00:00.000Z"));
	const topics = sink
		.getRecords()
		.map((record) => (record.envelope as Record<string, unknown>).topic)
		.filter((value): value is string => typeof value === "string");

	expect(topics).toContain("audit.retention.deleted");
});
