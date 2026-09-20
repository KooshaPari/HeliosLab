/**
 * Tests for {@link FileBackedAuditDurableStore} focusing on the
 * record-id sanitisation collision that the slice-3 review threads
 * flagged: `a/b` and `a\b` previously sanitised to the same filename.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	FileBackedAuditDurableStore,
	Slice1AuditDurabilityPlaceholder,
} from "../../../src/audit/durable_store.js";
import type { AuditRecord } from "../../../src/audit/sink-types.js";

function makeRecord(id: string): AuditRecord & { id: string } {
	return {
		id,
		recorded_at: "2026-01-01T00:00:00.000Z",
		sequence: 1,
		outcome: "accepted",
		reason: null,
		envelope: { id: id },
	};
}

describe("FileBackedAuditDurableStore recordId sanitisation", () => {
	let tmpDir: string;
	let store: FileBackedAuditDurableStore;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-audit-durable-"));
		store = new FileBackedAuditDurableStore(tmpDir);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("sanitised ids for unsafe characters are unique across inputs", async () => {
		// Both `a/b` and `a\b` would naïvely sanitise to `a_b`; with the
		// hash prefix they must resolve to distinct filenames.
		await store.append(makeRecord("a/b"));
		await store.append(makeRecord("a\\b"));
		const replayed = await store.replay();
		expect(replayed.length).toBe(2);
		const ids = replayed.map((r) => (r as AuditRecord & { id?: string }).id);
		expect(new Set(ids).size).toBe(2);
	});

	test("safe ids pass through unchanged", async () => {
		await store.append(makeRecord("safe_id-1"));
		const replayed = await store.replay();
		expect(replayed.length).toBe(1);
		expect((replayed[0] as AuditRecord & { id?: string }).id).toBe("safe_id-1");
	});

	test("records without an id are auto-generated", async () => {
		const record: AuditRecord = {
			recorded_at: "2026-01-01T00:00:00.000Z",
			sequence: 1,
			outcome: "accepted",
			reason: null,
			envelope: {},
		};
		await store.append(record);
		const replayed = await store.replay();
		expect(replayed.length).toBe(1);
		const id = (replayed[0] as AuditRecord & { id?: string }).id;
		expect(typeof id).toBe("string");
		expect((id ?? "").length).toBeGreaterThan(0);
	});

	test("id with colon, asterisk, and question mark are all distinct", async () => {
		const records = ["a:b", "a*b", "a?b", "a/b", "a\\b"].map(makeRecord);
		for (const r of records) await store.append(r);
		const replayed = await store.replay();
		expect(replayed.length).toBe(records.length);
		const ids = replayed
			.map((r) => (r as AuditRecord & { id?: string }).id)
			.filter((x): x is string => typeof x === "string");
		expect(new Set(ids).size).toBe(records.length);
	});

	test("files on disk do not collide (no overwrite)", async () => {
		await store.append(makeRecord("a/b"));
		await store.append(makeRecord("a\\b"));
		const auditDir = path.join(tmpDir, "recovery", "audit");
		const names = await fs.readdir(auditDir);
		const jsonFiles = names.filter((n) => n.endsWith(".json"));
		expect(jsonFiles.length).toBe(2);
		expect(new Set(jsonFiles).size).toBe(2);
	});
});

describe("FileBackedAuditDurableStore basic ops", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-audit-durable-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("replay returns empty array when dir missing", async () => {
		const fresh = new FileBackedAuditDurableStore(
			path.join(tmpDir, "never-created"),
		);
		expect(await fresh.replay()).toEqual([]);
	});

	test("replay filters by fromRecordedAt", async () => {
		const store = new FileBackedAuditDurableStore(tmpDir);
		await store.append({
			...makeRecord("r-old"),
			recorded_at: "2026-01-01T00:00:00.000Z",
		});
		await store.append({
			...makeRecord("r-new"),
			recorded_at: "2026-02-01T00:00:00.000Z",
		});
		const filtered = await store.replay("2026-01-15T00:00:00.000Z");
		expect(filtered.length).toBe(1);
		expect((filtered[0] as AuditRecord & { id?: string }).id).toBe("r-new");
	});
});

describe("Slice1AuditDurabilityPlaceholder", () => {
	test("append throws slice_2_durability_not_implemented", async () => {
		const placeholder = new Slice1AuditDurabilityPlaceholder();
		await expect(placeholder.append({} as never)).rejects.toThrow(
			/slice_2_durability_not_implemented/,
		);
	});

	test("replay returns an empty list", async () => {
		const placeholder = new Slice1AuditDurabilityPlaceholder();
		await expect(placeholder.replay()).resolves.toEqual([]);
	});
});
