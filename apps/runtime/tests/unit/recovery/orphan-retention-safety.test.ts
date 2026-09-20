/**
 * Tests for {@link enforceRetentionImpl} safety net. Covers the
 * slice-3 review thread flagging the previous
 * `entries.length === 1 && checkpointEntry` guard — when an expired
 * `.tmp` companion was present, the live `checkpoint.json` could be
 * deleted by the age/count/bytes passes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enforceRetentionImpl } from "../../../src/recovery/orphan-retention.js";

async function writeJson(filePath: string, body: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(body, null, 2));
}

async function makeOld(filePath: string, body: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, body);
	const past = (Date.now() - 2 * 60 * 60 * 1000) / 1000; // 2h ago
	await fs.utimes(filePath, past, past);
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

const VALID_CHECKPOINT = {
	version: 1,
	timestamp: Date.now(),
	workspace_id: "ws-1",
	sessions: [],
	checksum: "0".repeat(64),
};

describe("enforceRetentionImpl safety net", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-retention-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("returns zero removals when recovery dir is missing", async () => {
		const result = await enforceRetentionImpl({
			dataDir: tmpDir,
			maxAgeMs: 0,
		});
		expect(result.removed).toBe(0);
		expect(result.kept).toBe(0);
	});

	test("preserves valid live checkpoint.json even when expired", async () => {
		// The fix: safety net no longer requires the directory to contain
		// only the checkpoint.json. An expired `.tmp` companion must not
		// cause the live checkpoint to be deleted.
		const checkpointPath = path.join(tmpDir, "recovery", "checkpoint.json");
		await makeOld(checkpointPath, JSON.stringify(VALID_CHECKPOINT));
		await makeOld(
			path.join(tmpDir, "recovery", "expired.tmp"),
			"orphan content",
		);
		const result = await enforceRetentionImpl({
			dataDir: tmpDir,
			maxAgeMs: 60 * 60 * 1000,
		});
		// The .tmp was deleted but the live checkpoint survives.
		expect(await fileExists(checkpointPath)).toBe(true);
		expect(await fileExists(path.join(tmpDir, "recovery", "expired.tmp"))).toBe(
			false,
		);
		expect(result.removedFiles).not.toContain(checkpointPath);
	});

	test("preserves valid live checkpoint.json under maxCount trimming", async () => {
		const checkpointPath = path.join(tmpDir, "recovery", "checkpoint.json");
		await writeJson(checkpointPath, VALID_CHECKPOINT);
		// Add several expired companions so maxCount=1 must trim them all.
		for (let i = 0; i < 5; i++) {
			await makeOld(
				path.join(tmpDir, "recovery", `old-${i}.tmp`),
				`old content ${i}`,
			);
		}
		const result = await enforceRetentionImpl({
			dataDir: tmpDir,
			maxCount: 1,
		});
		expect(await fileExists(checkpointPath)).toBe(true);
		expect(result.removedFiles).not.toContain(checkpointPath);
	});

	test("preserves valid live checkpoint.json under byte-budget trimming", async () => {
		const checkpointPath = path.join(tmpDir, "recovery", "checkpoint.json");
		await writeJson(checkpointPath, VALID_CHECKPOINT);
		// One large expired file plus several smaller ones; budget forces trim.
		const big = Buffer.alloc(2_000_000, "x");
		await fs.writeFile(path.join(tmpDir, "recovery", "big.tmp"), big);
		const past = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
		await fs.utimes(path.join(tmpDir, "recovery", "big.tmp"), past, past);
		const result = await enforceRetentionImpl({
			dataDir: tmpDir,
			maxBytes: 100_000,
		});
		expect(await fileExists(checkpointPath)).toBe(true);
		expect(result.removedFiles).not.toContain(checkpointPath);
	});

	test("does NOT preserve an invalid (corrupt) checkpoint.json", async () => {
		// Safety net only protects checkpoints that validate; an invalid
		// one is fair game for the retention passes.
		const checkpointPath = path.join(tmpDir, "recovery", "checkpoint.json");
		await makeOld(checkpointPath, "this is not valid JSON");
		await enforceRetentionImpl({ dataDir: tmpDir, maxAgeMs: 60 * 60 * 1000 });
		expect(await fileExists(checkpointPath)).toBe(false);
	});

	test("keeps valid checkpoint.json when its mtime is fresh (no removal needed)", async () => {
		const checkpointPath = path.join(tmpDir, "recovery", "checkpoint.json");
		await writeJson(checkpointPath, VALID_CHECKPOINT);
		const result = await enforceRetentionImpl({
			dataDir: tmpDir,
			maxAgeMs: 60 * 60 * 1000,
		});
		expect(await fileExists(checkpointPath)).toBe(true);
		expect(result.removed).toBe(0);
	});
});
