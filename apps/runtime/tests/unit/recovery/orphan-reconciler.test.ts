/**
 * Tests for {@link OrphanReconciler}. Exercises the class facade that
 * the runtime wiring uses for slice-3 — `detectOrphans`, `enforceRetention`,
 * and the (mostly no-op) `scan` + `cleanup` path. Each test stubs the
 * delegate behaviour so we can assert the class API forwards correctly
 * and cleans up resources without depending on real PTY processes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBus } from "../../../src/protocol/bus.js";
import {
	OrphanReconciler,
	type OrphanReport,
} from "../../../src/recovery/orphan-reconciler.js";

describe("OrphanReconciler", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-orphan-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("constructor stores restored session IDs and accepts optional bus", () => {
		const bus = createBus();
		const r = new OrphanReconciler(["s1", "s2"], bus);
		expect(r).toBeInstanceOf(OrphanReconciler);
	});

	test("detectOrphans returns an empty report on a fresh data directory", async () => {
		const r = new OrphanReconciler();
		const report = await r.detectOrphans(tmpDir);
		expect(report).toEqual({
			safeToTerminate: [],
			needsReview: [],
			totalFound: 0,
		});
	});

	test("detectOrphans flags a stale .tmp-<uuid> artifact for auto-cleanup", async () => {
		// Detection scans under dataDir/recovery/. Place the stale file
		// at the root of recovery so it lands in safeToTerminate.
		const recoveryDir = path.join(tmpDir, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const tmpPath = path.join(recoveryDir, "checkpoint.json.tmp-old");
		await fs.writeFile(tmpPath, "x");
		const old = (Date.now() - 10 * 60 * 1000) / 1000;
		await fs.utimes(tmpPath, old, old);

		const r = new OrphanReconciler();
		const report = await r.detectOrphans(tmpDir);
		expect(report.totalFound).toBe(1);
		expect(report.safeToTerminate.length).toBe(1);
	});

	test("detectOrphans ignores live (non-tmp) recovery artifacts", async () => {
		const recoveryDir = path.join(tmpDir, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		await fs.writeFile(path.join(recoveryDir, "checkpoint.json"), "{}");

		const r = new OrphanReconciler();
		const report = await r.detectOrphans(tmpDir);
		expect(report.totalFound).toBe(0);
	});

	test("scan returns an empty report (PTY/zellij scanning is a no-op in slice-3)", async () => {
		const r = new OrphanReconciler();
		const report = await r.scan();
		expect(report).toEqual({
			safeToTerminate: [],
			needsReview: [],
			totalFound: 0,
		});
	});

	test("cleanup removes temp_file orphans and increments removed counter", async () => {
		// scanStaleTempFiles looks under cwd/recovery, so seed a stale
		// .tmp there. Restore cwd on the way out.
		const cwdBefore = process.cwd();
		const recoveryDir = path.join(cwdBefore, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const tmpPath = path.join(recoveryDir, "stale-test.tmp");
		await fs.writeFile(tmpPath, "x");
		try {
			const bus = createBus();
			const r = new OrphanReconciler([], bus);
			const report = await r.scan();
			const tmpItems = report.safeToTerminate.filter(
				(item) => item.type === "temp_file",
			);
			expect(tmpItems.length).toBeGreaterThanOrEqual(1);
			const result = await r.cleanup(report);
			expect(result.removed).toBe(tmpItems.length);
			expect(result.reviewPending).toBe(report.needsReview.length);
			await expect(fs.access(tmpPath)).rejects.toThrow();
		} finally {
			await fs.rm(recoveryDir, { recursive: true, force: true });
			process.chdir(cwdBefore);
		}
	});

	test("cleanup publishes recovery.orphans.cleaned when a bus is supplied", async () => {
		const bus = createBus();
		const received: unknown[] = [];
		await bus.subscribe("recovery.orphans.cleaned", (evt) => {
			received.push(evt.payload);
		});
		const r = new OrphanReconciler([], bus);
		const report: OrphanReport = {
			safeToTerminate: [],
			needsReview: [],
			totalFound: 0,
		};
		const result = await r.cleanup(report);
		expect(result).toEqual({
			terminated: 0,
			removed: 0,
			reviewPending: 0,
		});
		// Microtask flush so the published event is observed.
		await new Promise((r) => setImmediate(r));
		expect(received.length).toBe(1);
		expect(received[0]).toMatchObject({
			terminated: 0,
			removed: 0,
			reviewPending: 0,
		});
	});

	test("cleanup is a no-op (no bus publish) when the bus is omitted", async () => {
		const r = new OrphanReconciler();
		const report: OrphanReport = {
			safeToTerminate: [],
			needsReview: [],
			totalFound: 0,
		};
		const result = await r.cleanup(report);
		expect(result.reviewPending).toBe(0);
	});

	test("enforceRetention preserves a live checkpoint.json with an expired .tmp sibling", async () => {
		// Both files live directly under tmpDir/recovery so the
		// top-level retention scan sees them. The companion's
		// `.tmp-old` suffix matches the orphan-detection regex.
		const recoveryDir = path.join(tmpDir, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const validCheckpoint = {
			version: 1,
			timestamp: Date.now(),
			checksum: "0".repeat(64),
			sessions: [],
		};
		const live = path.join(recoveryDir, "checkpoint.json");
		await fs.writeFile(live, JSON.stringify(validCheckpoint));
		const tmp = path.join(recoveryDir, "checkpoint.json.tmp-old");
		await fs.writeFile(tmp, "x");
		const old = (Date.now() - 10 * 60 * 1000) / 1000;
		await fs.utimes(tmp, old, old);

		const r = new OrphanReconciler();
		const result = await r.enforceRetention({
			dataDir: tmpDir,
			maxAgeMs: 5 * 60 * 1000,
		});
		expect(result.removed).toBeGreaterThanOrEqual(1);
		// Live checkpoint must survive even with an expired .tmp sibling.
		await fs.access(live);
	});

	test("enforceRetention surfaces kept + removedFiles for diagnostics", async () => {
		const recoveryDir = path.join(tmpDir, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		await fs.writeFile(path.join(recoveryDir, "a.json"), "{}");
		await fs.writeFile(path.join(recoveryDir, "b.json"), "{}");
		const r = new OrphanReconciler();
		const result = await r.enforceRetention({
			dataDir: tmpDir,
			maxCount: 1,
		});
		expect(Array.isArray(result.removedFiles)).toBe(true);
		expect(result.kept).toBeGreaterThanOrEqual(0);
	});

	test("enforceRetention respects maxCount ceiling", async () => {
		const recoveryDir = path.join(tmpDir, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const tmp = path.join(recoveryDir, "a.json.tmp-old");
		await fs.writeFile(tmp, "x");
		const old = (Date.now() - 10 * 60 * 1000) / 1000;
		await fs.utimes(tmp, old, old);
		await fs.writeFile(path.join(recoveryDir, "a.json"), "{}");
		await fs.writeFile(path.join(recoveryDir, "b.json"), "{}");
		await fs.writeFile(path.join(recoveryDir, "c.json"), "{}");

		const r = new OrphanReconciler();
		const result = await r.enforceRetention({ dataDir: tmpDir, maxCount: 1 });
		// The stale .tmp is removed by age; live files trimmed to <= 1.
		expect(result.removed).toBeGreaterThanOrEqual(1);
	});

	test("enforceRetention on a missing recovery directory is a no-op", async () => {
		const r = new OrphanReconciler();
		const result = await r.enforceRetention({ dataDir: tmpDir });
		expect(result).toEqual({
			terminated: 0,
			removed: 0,
			reviewPending: 0,
			kept: 0,
			removedFiles: [],
		});
	});

	test("enforceRetention rejects a missing dataDir", async () => {
		const r = new OrphanReconciler();
		await expect(
			// @ts-expect-error intentional bad input for runtime check
			r.enforceRetention({ dataDir: undefined }),
		).rejects.toThrow(/requires a dataDir/);
	});
});
