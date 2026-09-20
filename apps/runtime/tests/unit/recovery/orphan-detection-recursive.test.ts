/**
 * Tests for {@link detectOrphansImpl} recursive scan. Covers the
 * slice-3 review threads flagging:
 * - top-level-only scan missing subdirectory orphans
 * - the `.tmp` exact-match not catching `.tmp-<uuid>` rotation leftovers
 * - missing `.rollback` / `.partial` half-applied mutation artifacts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectOrphansImpl } from "../../../src/recovery/orphan-detection.js";
import { STALE_TEMP_FILE_MS } from "../../../src/recovery/orphan-reconciler.js";

async function makeOldFile(filePath: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, "x");
	const past = (Date.now() - STALE_TEMP_FILE_MS - 60_000) / 1000;
	await fs.utimes(filePath, past, past);
}

async function makeFreshFile(filePath: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, "x");
}

describe("detectOrphansImpl recursive scan", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-orphan-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("returns empty report when recovery dir is missing", async () => {
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate).toEqual([]);
		expect(report.needsReview).toEqual([]);
		expect(report.totalFound).toBe(0);
	});

	test("flags a top-level .tmp-<uuid> file left by atomic-rename rotation", async () => {
		const file = path.join(tmpDir, "recovery", "checkpoint.json.tmp-abc-123");
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
		expect(report.safeToTerminate[0]?.description).toContain("Stale temp");
	});

	test("flags a plain .tmp file (legacy CheckpointWriter format)", async () => {
		const file = path.join(tmpDir, "recovery", "old.tmp");
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("flags a stale .tmp file inside a per-session subdirectory", async () => {
		// This is the case the original top-level-only scanner missed.
		const file = path.join(
			tmpDir,
			"recovery",
			"sessions",
			"session-1",
			"cp-1.json.tmp-uuid",
		);
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
		expect(report.safeToTerminate[0]?.path).toContain("cp-1.json.tmp-uuid");
	});

	test("flags a stale .tmp file inside the audit store dir", async () => {
		const file = path.join(tmpDir, "recovery", "audit", "rec-1.json.tmp-uuid");
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("flags deeply-nested .tmp files (BFS recurses)", async () => {
		const file = path.join(
			tmpDir,
			"recovery",
			"sessions",
			"session-1",
			"nested",
			"more",
			"x.json.tmp-uuid",
		);
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("does NOT flag fresh .tmp files (within stale threshold)", async () => {
		const file = path.join(tmpDir, "recovery", "fresh.tmp");
		await makeFreshFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate).toEqual([]);
	});

	test("flags .rollback artifacts as safe-to-terminate", async () => {
		const file = path.join(tmpDir, "recovery", "mutation-1.rollback");
		await makeFreshFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("flags .partial artifacts as safe-to-terminate", async () => {
		const file = path.join(tmpDir, "recovery", "mutation-1.partial");
		await makeFreshFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("lone checkpoint.json.backup goes to needsReview", async () => {
		const backup = path.join(tmpDir, "recovery", "checkpoint.json.backup");
		await makeFreshFile(backup);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(0);
		expect(report.needsReview.length).toBe(1);
		expect(report.needsReview[0]?.description).toContain("Lone");
	});

	test("checkpoint.json.backup alongside live checkpoint is safe-to-terminate", async () => {
		const backup = path.join(tmpDir, "recovery", "checkpoint.json.backup");
		const live = path.join(tmpDir, "recovery", "checkpoint.json");
		await makeFreshFile(backup);
		await makeFreshFile(live);
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.safeToTerminate.length).toBe(1);
		expect(report.safeToTerminate[0]?.description).toContain("Backup");
	});

	test("temp files referencing an unknown session id go to needsReview", async () => {
		const file = path.join(
			tmpDir,
			"recovery",
			"sessions",
			"orphan-session",
			"x.tmp-uuid",
		);
		await makeOldFile(file);
		const report = await detectOrphansImpl(tmpDir, new Set(["known-session"]));
		expect(report.safeToTerminate).toEqual([]);
		expect(report.needsReview.length).toBe(1);
		expect(report.needsReview[0]?.description).toContain("not in restored set");
	});

	test("does not infinite-loop on circular symlinks", async () => {
		const recoveryDir = path.join(tmpDir, "recovery");
		const loopDir = path.join(recoveryDir, "loop");
		await fs.mkdir(loopDir, { recursive: true });
		// On Windows symlink creation may fail without admin; skip if so.
		try {
			await fs.symlink(recoveryDir, path.join(loopDir, "self"), "dir");
		} catch {
			// Best-effort: still verify no infinite loop when the link is missing.
		}
		const report = await detectOrphansImpl(tmpDir, new Set());
		expect(report.totalFound).toBe(0);
	});
});
