/**
 * CVP integration tests — concurrency scaling evidence.
 *
 * Validates that the vertical slice driver scales to the documented
 * concurrent lane targets without regression. Run from the repo root:
 *
 *   bun test apps/runtime/tests/cvp/cvp-scaling.test.ts
 *
 * Traces to: Q7=A (1000 concurrent sessions is the real target)
 */

import { describe, expect, it } from "bun:test";
import { InMemoryLocalBus } from "../../src/protocol/bus.js";
import { RecordingRendererAdapter } from "../../src/renderer/recording_adapter.js";
import { VerticalSliceDriver } from "../../src/runtime/vertical_slice_driver.js";
import { LaneLifecycleService } from "../../src/sessions/state_machine.js";

const WORKSPACE = "ws-cvp";
const PROJECT_CONTEXT = "pc-cvp";

interface CvpResult {
	created: number;
	bound: number;
	durationMs: number;
	errors: Array<{ laneId: string; message: string }>;
}

async function runCvp(count: number): Promise<CvpResult> {
	const bus = new InMemoryLocalBus();
	const lanes = new LaneLifecycleService(bus);
	const renderer = new RecordingRendererAdapter();
	await renderer.init({
		gpuAcceleration: false,
		colorDepth: 24,
		maxDimensions: { cols: 200, rows: 50 },
	});
	await renderer.start({
		windowId: "cvp-window",
		bounds: { x: 0, y: 0, width: 800, height: 600 },
	});

	const driver = new VerticalSliceDriver({
		bus,
		renderer,
		maxPtys: count + 100,
	});
	driver.start();

	const start = performance.now();

	// Create a lane and wait for its terminal, in parallel.
	const lanePromises: Array<Promise<void>> = [];
	for (let i = 0; i < count; i++) {
		lanePromises.push(
			(async () => {
				const lane = await lanes.create({
					workspace_id: WORKSPACE,
					project_context_id: PROJECT_CONTEXT,
					display_name: `cvp-${count}-${i}`,
				});
				await driver.waitForLane(lane.lane_id, 60_000);
			})(),
		);
	}
	await Promise.allSettled(lanePromises);
	await driver.settle();

	const durationMs = performance.now() - start;
	const bound = driver.laneIds().length;
	const errors = driver.errors.map((e) => ({
		laneId: e.laneId,
		message: e.message,
	}));

	await driver.shutdown();
	return { created: bound, bound, durationMs, errors };
}

/**
 * These suites are opt-in.
 *
 * Materialising hundreds of live PTYs in-process starves any suite running
 * beside it: the coverage gate sweeps `apps/runtime/tests` with `--coverage`,
 * and this load made unrelated, load-sensitive tests fail (git commits in
 * temp repos returning `exit null`, the 50-lane lane stress test timing out).
 * So the heavy suites only run when asked for.
 *
 *   bun run cvp:scaling          # 25 / 100 / 250 lanes
 *   CVP_SCALING=1 CVP_TARGET=1000 bun test apps/runtime/tests/cvp/cvp-scaling.test.ts
 */
const SCALING_ENABLED = process.env.CVP_SCALING === "1";
const CVP_TARGET = Number.parseInt(process.env.CVP_TARGET ?? "0", 10);

describe.skipIf(!SCALING_ENABLED)("CVP scaling", () => {
	// SonarCloud S5976 wants these three lanes-count tests parameterized so
	// the assertion logic is shared. bun:test's it.each takes the row data
	// as the first callback argument.
	it.each([
		{ count: 25, durationBudgetMs: 30_000 },
		{ count: 100, durationBudgetMs: 60_000 },
		{ count: 250, durationBudgetMs: 120_000 },
	])("materialises $count concurrent lanes", ({ count, durationBudgetMs }) => {
		return runCvp(count).then((r) => {
			expect(r.errors).toHaveLength(0);
			expect(r.bound).toBe(count);
			expect(r.durationMs).toBeLessThan(durationBudgetMs);
		});
	});
});

if (CVP_TARGET > 0) {
	describe("CVP scaling (extended targets)", () => {
		it(`materialises ${CVP_TARGET} concurrent lanes (CVP target)`, async () => {
			const r = await runCvp(CVP_TARGET);
			expect(r.errors).toHaveLength(0);
			expect(r.bound).toBe(CVP_TARGET);
		}, 900_000);
	});
}
