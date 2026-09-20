import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuditRecord } from "../../audit/sink.js";
import { FileBackedAuditDurableStore } from "../durable_store.js";

function mkRecord(overrides: Partial<AuditRecord>): AuditRecord {
	return {
		recorded_at: "2026-01-01T00:00:00.000Z",
		sequence: 1,
		outcome: "accepted",
		reason: null,
		envelope: { type: "event" },
		...overrides,
	};
}

describe("FileBackedAuditDurableStore", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "audit-durable-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("constructor rejects empty or non-string dataDir", () => {
		expect(() => new FileBackedAuditDurableStore("")).toThrow();
		expect(
			() => new FileBackedAuditDurableStore(undefined as unknown as string),
		).toThrow();
	});

	it("replay on missing dir returns empty array", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		const out = await store.replay();
		expect(out).toEqual([]);
	});

	it("append then replay round-trips a single record", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		const rec = mkRecord({ sequence: 7, workspace_id: "ws-A" });
		await store.append(rec);
		const out = await store.replay();
		expect(out).toHaveLength(1);
		expect(out[0]?.sequence).toBe(7);
		expect(out[0]?.workspace_id).toBe("ws-A");
		expect(out[0]?.id).toBeString();
	});

	it("replay returns records sorted by recorded_at asc", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		await store.append(
			mkRecord({ recorded_at: "2026-03-01T00:00:00.000Z", sequence: 3 }),
		);
		await store.append(
			mkRecord({ recorded_at: "2026-01-01T00:00:00.000Z", sequence: 1 }),
		);
		await store.append(
			mkRecord({ recorded_at: "2026-02-01T00:00:00.000Z", sequence: 2 }),
		);
		const out = await store.replay();
		expect(out.map((r) => r.sequence)).toEqual([1, 2, 3]);
	});

	it("replay with fromRecordedAt filter drops earlier records", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		await store.append(
			mkRecord({ recorded_at: "2026-01-01T00:00:00.000Z", sequence: 1 }),
		);
		await store.append(
			mkRecord({ recorded_at: "2026-02-01T00:00:00.000Z", sequence: 2 }),
		);
		await store.append(
			mkRecord({ recorded_at: "2026-03-01T00:00:00.000Z", sequence: 3 }),
		);
		const out = await store.replay("2026-02-01T00:00:00.000Z");
		expect(out.map((r) => r.sequence)).toEqual([2, 3]);
	});

	it("append assigns deterministic id when record.id is missing", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		const rec = mkRecord({ sequence: 42, id: undefined });
		await store.append(rec);
		const out = await store.replay();
		expect(out[0]?.id).toBeString();
		expect(out[0]?.id?.length).toBeGreaterThan(0);
	});

	it("append sanitizes id when caller provides unsafe chars", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		const rec = mkRecord({ id: "../../etc/passwd" });
		await store.append(rec);
		const out = await store.replay();
		expect(out[0]?.id).not.toContain("/");
		expect(out[0]?.id).not.toContain(".");
	});

	it("replay ignores non-json files in the audit dir", async () => {
		const store = new FileBackedAuditDurableStore(dir);
		await store.append(mkRecord({ sequence: 1 }));
		await store.append(mkRecord({ sequence: 2 }));
		// Drop a stray file into the directory
		const fs = await import("node:fs/promises");
		await fs.writeFile(path.join(dir, "recovery", "audit", "garbage.tmp"), "x");
		const out = await store.replay();
		expect(out).toHaveLength(2);
	});
});
