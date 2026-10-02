/**
 * OrphanReconciler surface coverage.
 *
 * Exercises every public path of {@link OrphanReconciler} so the coverage gate
 * has evidence the recovery slice's cleanup machinery actually runs:
 *
 *   - scan() returns empty buckets when nothing is wrong
 *   - scan() surfaces stale temp files in the cwd "recovery" directory
 *   - cleanup() removes temp_file orphans and counts them
 *   - cleanup() publishes recovery.orphans.cleaned when a bus is wired
 *   - cleanup() tolerates a missing bus (just logs)
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
	OrphanReconciler,
	type OrphanReport,
} from "../../../src/recovery/orphan-reconciler.js";
import { emptyDir, RecordingBus } from "../../helpers/test-tmp.js";

describe("OrphanReconciler surface coverage", () => {
	let cwdSnapshot: string;
	let tempCwd: string;

	beforeEach(async () => {
		cwdSnapshot = process.cwd();
		tempCwd = await emptyDir("orphan-reconciler");
		process.chdir(tempCwd);
	});

	afterEach(async () => {
		process.chdir(cwdSnapshot);
		await fs.rm(tempCwd, { recursive: true, force: true }).catch(() => {});
	});

	it("scan() returns empty buckets when no recovery directory exists", async () => {
		const reconciler = new OrphanReconciler([]);
		const report = await reconciler.scan();
		expect(report.safeToTerminate).toHaveLength(0);
		expect(report.needsReview).toHaveLength(0);
		expect(report.totalFound).toBe(0);
	});

	it("scan() surfaces stale .tmp files in cwd/recovery", async () => {
		const recoveryDir = path.join(tempCwd, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const staleA = path.join(recoveryDir, "scratch.tmp");
		const staleB = path.join(recoveryDir, "scratch2.tmp");
		await fs.writeFile(staleA, "stale");
		await fs.writeFile(staleB, "stale");
		await fs.writeFile(path.join(recoveryDir, "keep.json"), "{}", "utf8");

		const reconciler = new OrphanReconciler(["session-a"]);
		const report = await reconciler.scan();
		expect(report.totalFound).toBe(2);
		expect(report.safeToTerminate).toHaveLength(2);
		expect(report.safeToTerminate.map((item) => item.id).sort()).toEqual([
			"scratch.tmp",
			"scratch2.tmp",
		]);
		expect(report.needsReview).toHaveLength(0);
	});

	it("cleanup() removes temp_file orphans and reports counts", async () => {
		const recoveryDir = path.join(tempCwd, "recovery");
		await fs.mkdir(recoveryDir, { recursive: true });
		const stale = path.join(recoveryDir, "will-be-removed.tmp");
		await fs.writeFile(stale, "stale");

		const reconciler = new OrphanReconciler([]);
		const report = await reconciler.scan();
		const result = await reconciler.cleanup(report);

		expect(result.terminated).toBe(0);
		expect(result.removed).toBe(1);
		expect(result.reviewPending).toBe(0);
		await expect(fs.access(stale)).rejects.toThrow();
	});

	it("cleanup() publishes recovery.orphans.cleaned when a bus is wired", async () => {
		const bus = new RecordingBus();
		const reconciler = new OrphanReconciler(["session-a"], bus);
		const report: OrphanReport = {
			safeToTerminate: [],
			needsReview: [
				{
					type: "pty",
					id: "needs-review-pty",
					description: "Manual review required",
				},
			],
			totalFound: 1,
		};

		const result = await reconciler.cleanup(report);

		expect(result.terminated).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.reviewPending).toBe(1);

		const cleaned = bus.published.find(
			(envelope) => envelope.topic === "recovery.orphans.cleaned",
		);
		expect(cleaned).toBeDefined();
		expect(cleaned?.payload).toMatchObject({
			terminated: 0,
			removed: 0,
			reviewPending: 1,
		});
	});

	it("cleanup() tolerates a missing bus (no event published)", async () => {
		const reconciler = new OrphanReconciler([]);
		const report: OrphanReport = {
			safeToTerminate: [],
			needsReview: [],
			totalFound: 0,
		};

		const result = await reconciler.cleanup(report);
		expect(result).toEqual({ terminated: 0, removed: 0, reviewPending: 0 });
	});

	it("cleanup() handles a temp_file path that vanishes before removal", async () => {
		const reconciler = new OrphanReconciler([]);
		const missingPath = path.join(tempCwd, "never-existed.tmp");
		const report: OrphanReport = {
			safeToTerminate: [
				{
					type: "temp_file",
					id: "ghost",
					description: "Already gone",
					path: missingPath,
				},
			],
			needsReview: [],
			totalFound: 1,
		};

		const result = await reconciler.cleanup(report);
		expect(result.removed).toBe(0);
		expect(result.terminated).toBe(0);
	});
});
