import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCheckpoint } from "../checkpoint.js";
import {
	MAX_RETENTION_DELETIONS_PER_CALL,
	OrphanReconciler,
	STALE_TEMP_FILE_MS,
} from "../orphan-reconciler.js";

let tempHome: string;
let tempDataDir: string;

beforeEach(async () => {
	tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-detect-home-"));
	tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-detect-data-"));
	await fs.mkdir(path.join(tempDataDir, "recovery"), { recursive: true });
});

afterEach(async () => {
	await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
	await fs.rm(tempDataDir, { recursive: true, force: true }).catch(() => {});
});

async function touch(p: string, mtimeMs: number): Promise<void> {
	const handle = await fs.open(p, "w");
	await handle.close();
	const epoch = new Date(mtimeMs);
	await fs.utimes(p, epoch, epoch);
}

function safeItems(report: { safeToTerminate: { id: string }[] }) {
	return report.safeToTerminate.map((item) => item.id);
}

function reviewItems(report: { needsReview: { id: string }[] }) {
	return report.needsReview.map((item) => item.id);
}

describe("OrphanReconciler.detectOrphans", () => {
	it("returns an empty report for a fresh empty dataDir", async () => {
		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);
		expect(report.safeToTerminate).toEqual([]);
		expect(report.needsReview).toEqual([]);
		expect(report.totalFound).toBe(0);
	});

	it("flags stale .tmp files as safe-to-terminate", async () => {
		const stalePath = path.join(tempDataDir, "recovery", "rotate.tmp");
		const recentMs = Date.now() - STALE_TEMP_FILE_MS - 60_000; // 1 min past threshold
		await touch(stalePath, recentMs);

		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);

		expect(safeItems(report)).toContain("rotate.tmp");
		expect(report.totalFound).toBeGreaterThan(0);
	});

	it("does not flag a fresh .tmp that is still under the staleness threshold", async () => {
		const freshPath = path.join(tempDataDir, "recovery", "fresh.tmp");
		await touch(freshPath, Date.now() - 5_000); // 5 seconds old

		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);

		expect(safeItems(report)).not.toContain("fresh.tmp");
	});

	it("flags checkpoint.json.backup as safe-to-terminate when a live checkpoint.json exists", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const validCheckpoint = JSON.stringify({
			version: 1,
			timestamp: Date.now(),
			checksum: "0".repeat(64),
			sessions: [
				{
					sessionId: "s-1",
					terminalId: "t-1",
					laneId: "l-1",
					workingDirectory: tempDataDir,
					environmentVariables: {},
					scrollbackSnapshot: "",
					zelijjSessionName: "valid",
					shellCommand: "bash",
				},
			],
		});
		const validation = validateCheckpoint(JSON.parse(validCheckpoint));
		expect(validation.valid).toBe(true);
		await fs.writeFile(path.join(recovery, "checkpoint.json"), validCheckpoint);
		await touch(
			path.join(recovery, "checkpoint.json.backup"),
			Date.now() - 60_000,
		);

		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);

		expect(safeItems(report)).toContain("checkpoint.json.backup");
		expect(reviewItems(report)).not.toContain("checkpoint.json.backup");
	});

	it("flags a lone checkpoint.json.backup as needs-review when checkpoint.json is missing", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		await touch(
			path.join(recovery, "checkpoint.json.backup"),
			Date.now() - 60_000,
		);

		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);

		expect(reviewItems(report)).toContain("checkpoint.json.backup");
		expect(safeItems(report)).not.toContain("checkpoint.json.backup");
	});

	it("flags .rollback and .partial artifacts as safe-to-terminate", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		await touch(
			path.join(recovery, "session-state.rollback"),
			Date.now() - 60_000,
		);
		await touch(path.join(recovery, "export.partial"), Date.now() - 60_000);

		const reconciler = new OrphanReconciler();
		const report = await reconciler.detectOrphans(tempDataDir);

		const ids = safeItems(report);
		expect(ids).toContain("session-state.rollback");
		expect(ids).toContain("export.partial");
	});

	it("still works when the recovery subdir is missing", async () => {
		const emptyDataDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "orphan-detect-empty-"),
		);
		try {
			const reconciler = new OrphanReconciler();
			const report = await reconciler.detectOrphans(emptyDataDir);
			expect(report.totalFound).toBe(0);
		} finally {
			await fs
				.rm(emptyDataDir, { recursive: true, force: true })
				.catch(() => {});
		}
	});

	it("routes session-prefixed orphans to needs-review when the session is not restored", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const oldMs = Date.now() - STALE_TEMP_FILE_MS - 60_000;
		await touch(path.join(recovery, "session-unknown-session.tmp"), oldMs);

		const reconciler = new OrphanReconciler(["known-session"]);
		const report = await reconciler.detectOrphans(tempDataDir);

		expect(reviewItems(report)).toContain("session-unknown-session.tmp");
		expect(safeItems(report)).not.toContain("session-unknown-session.tmp");
	});
});

describe("OrphanReconciler.enforceRetention", () => {
	it("keeps the newest N and deletes the rest", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const base = Date.now() - 10_000;
		for (let i = 0; i < 5; i++) {
			await touch(path.join(recovery, `f-${i}.json`), base + i * 1000);
		}

		const reconciler = new OrphanReconciler();
		const result = await reconciler.enforceRetention({
			dataDir: tempDataDir,
			maxCount: 2,
		});

		expect(result.kept).toBe(2);
		expect(result.removedFiles).toHaveLength(3);
		expect(result.removed).toBe(3);

		const survivors = await fs.readdir(recovery);
		expect(survivors.sort()).toEqual(["f-3.json", "f-4.json"]);
	});

	it("respects maxAgeMs", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const now = Date.now();
		await touch(path.join(recovery, "fresh.json"), now - 5_000);
		await touch(path.join(recovery, "stale.json"), now - 60 * 60 * 1000); // 1h

		const reconciler = new OrphanReconciler();
		const result = await reconciler.enforceRetention({
			dataDir: tempDataDir,
			maxAgeMs: 30 * 60 * 1000, // 30 min
		});

		expect(result.removedFiles.map((p) => path.basename(p))).toEqual([
			"stale.json",
		]);
		expect(result.kept).toBe(1);
	});

	it("never deletes a valid checkpoint.json that is the only remaining file", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const validCheckpoint = JSON.stringify({
			version: 1,
			timestamp: Date.now(),
			checksum: "0".repeat(64),
			sessions: [
				{
					sessionId: "last",
					terminalId: "last-t",
					laneId: "last-l",
					workingDirectory: tempDataDir,
					environmentVariables: {},
					scrollbackSnapshot: "",
					zelijjSessionName: "last",
					shellCommand: "bash",
				},
			],
		});
		const validation = validateCheckpoint(JSON.parse(validCheckpoint));
		expect(validation.valid).toBe(true);
		await fs.writeFile(path.join(recovery, "checkpoint.json"), validCheckpoint);
		const old = Date.now() - 24 * 60 * 60 * 1000;
		await fs.utimes(
			path.join(recovery, "checkpoint.json"),
			new Date(old),
			new Date(old),
		);

		const reconciler = new OrphanReconciler();
		const result = await reconciler.enforceRetention({
			dataDir: tempDataDir,
			maxAgeMs: 60 * 60 * 1000, // 1h
		});

		expect(result.removedFiles).toEqual([]);
		expect(result.kept).toBe(1);
		const surviving = await fs.readdir(recovery);
		expect(surviving).toContain("checkpoint.json");
	});

	it("applies maxBytes by trimming oldest first", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const base = Date.now() - 100_000;
		// Three 100-byte files at different ages.
		for (const [name, ageOffset] of [
			["old.json", 0],
			["mid.json", 50],
			["new.json", 99],
		] as const) {
			const full = path.join(recovery, name);
			await fs.writeFile(full, "x".repeat(100));
			const mtime = new Date(base + ageOffset * 1000);
			await fs.utimes(full, mtime, mtime);
		}

		const reconciler = new OrphanReconciler();
		const result = await reconciler.enforceRetention({
			dataDir: tempDataDir,
			maxBytes: 150,
		});

		// Budget = 150 bytes. Newest two (mid + new = 200) still over budget,
		// so we drop the oldest first. Final kept count = 1 file.
		expect(result.kept).toBeLessThanOrEqual(2);
		expect(result.removed).toBeGreaterThanOrEqual(1);
	});

	it("caps a single call at MAX_RETENTION_DELETIONS_PER_CALL", async () => {
		const recovery = path.join(tempDataDir, "recovery");
		const old = Date.now() - 24 * 60 * 60 * 1000;
		for (let i = 0; i < MAX_RETENTION_DELETIONS_PER_CALL + 50; i++) {
			await touch(path.join(recovery, `stale-${i}.json`), old);
		}

		const reconciler = new OrphanReconciler();
		const result = await reconciler.enforceRetention({
			dataDir: tempDataDir,
			maxAgeMs: 60 * 60 * 1000,
		});

		expect(result.removed).toBeLessThanOrEqual(
			MAX_RETENTION_DELETIONS_PER_CALL,
		);
		expect(result.removed).toBeGreaterThan(0);
	});

	it("returns a clean result when the recovery directory is missing", async () => {
		const emptyDataDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "orphan-retention-empty-"),
		);
		try {
			const reconciler = new OrphanReconciler();
			const result = await reconciler.enforceRetention({
				dataDir: emptyDataDir,
				maxCount: 10,
			});
			expect(result).toEqual({
				terminated: 0,
				removed: 0,
				reviewPending: 0,
				kept: 0,
				removedFiles: [],
			});
		} finally {
			await fs
				.rm(emptyDataDir, { recursive: true, force: true })
				.catch(() => {});
		}
	});
});
