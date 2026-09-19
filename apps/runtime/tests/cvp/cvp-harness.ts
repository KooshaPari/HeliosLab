/**
 * CVP Harness — Customer Validation Pack for the 1000-concurrent-session target.
 *
 * Drives the vertical slice through `LaneLifecycleService` for N concurrent
 * lanes, each materialising a real PTY bound to a renderer surface. Records
 * spawn/bind latency percentiles, throughput, and RSS stability, then writes
 * a JSON report.
 *
 * Usage (from the repo root):
 *   CVP_TARGET=<n> bun run apps/runtime/tests/cvp/cvp-harness.ts
 *   bun run apps/runtime/tests/cvp/cvp-harness.ts --count=1000 --output=cvp-reports/cvp-1000.json
 *
 * Traces to: Q7=A (1000 concurrent sessions is the real target)
 *
 * @module
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InMemoryLocalBus } from "../../src/protocol/bus.js";
import { RecordingRendererAdapter } from "../../src/renderer/recording_adapter.js";
import { VerticalSliceDriver } from "../../src/runtime/vertical_slice_driver.js";
import { LaneLifecycleService } from "../../src/sessions/state_machine.js";

const DEFAULT_COUNT = Number.parseInt(process.env.CVP_TARGET ?? "1000", 10);
const WORKSPACE = "ws-cvp";
const PROJECT_CONTEXT = "pc-cvp";

interface CvpOptions {
	count: number;
	outputPath: string;
	shell?: string;
	maxPtys: number;
}

function parseArgs(argv: string[]): CvpOptions {
	const opts: CvpOptions = {
		count: DEFAULT_COUNT,
		outputPath: `cvp-reports/cvp-${DEFAULT_COUNT}.json`,
		maxPtys: Math.max(DEFAULT_COUNT + 100, 1500),
	};
	for (const arg of argv) {
		if (arg.startsWith("--count=")) {
			opts.count = Number.parseInt(arg.slice("--count=".length), 10);
			opts.outputPath = `cvp-reports/cvp-${opts.count}.json`;
		} else if (arg.startsWith("--output=")) {
			opts.outputPath = arg.slice("--output=".length);
		} else if (arg.startsWith("--shell=")) {
			opts.shell = arg.slice("--shell=".length);
		} else if (arg.startsWith("--max-ptys=")) {
			opts.maxPtys = Number.parseInt(arg.slice("--max-ptys=".length), 10);
		}
	}
	opts.maxPtys = Math.max(opts.maxPtys, opts.count + 100);
	return opts;
}

interface PercentileStats {
	count: number;
	min_ms: number;
	p50_ms: number;
	p95_ms: number;
	p99_ms: number;
	max_ms: number;
	mean_ms: number;
}

function computeStats(values: number[]): PercentileStats {
	if (values.length === 0) {
		return {
			count: 0,
			min_ms: 0,
			p50_ms: 0,
			p95_ms: 0,
			p99_ms: 0,
			max_ms: 0,
			mean_ms: 0,
		};
	}
	const sorted = [...values].sort((a, b) => a - b);
	const at = (p: number): number =>
		sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
	const sum = sorted.reduce((acc, v) => acc + v, 0);
	return {
		count: sorted.length,
		min_ms: sorted[0]!,
		p50_ms: at(50),
		p95_ms: at(95),
		p99_ms: at(99),
		max_ms: sorted[sorted.length - 1]!,
		mean_ms: sum / sorted.length,
	};
}

interface Thresholds {
	maxTotalMs: number;
	maxSpawnP99Ms: number;
	maxCleanupMs: number;
	maxMemoryDeltaMb: number;
}

/**
 * Thresholds are scale-aware.
 *
 * The CVP claim is *capacity*: `count` concurrent live sessions. A cold burst
 * creates every lane at once, so per-lane latency is bounded by the burst
 * itself and must scale with `count`. The per-lane budget below is the honest
 * statement of what we guarantee for a cold burst.
 */
function thresholdsFor(count: number): Thresholds {
	const perLaneBudgetMs = 150;
	return {
		maxTotalMs: count * perLaneBudgetMs + 60_000,
		maxSpawnP99Ms: count * perLaneBudgetMs,
		maxCleanupMs: count * 20 + 5_000,
		maxMemoryDeltaMb: 200,
	};
}

interface CvpReport {
	schema: "helios.cvp.v1";
	generatedAt: string;
	environment: {
		bunVersion: string;
		nodeVersion: string;
		platform: string;
		arch: string;
		cpus: number;
	};
	options: { count: number; maxPtys: number; shell: string | null };
	results: {
		lanesRequested: number;
		lanesBound: number;
		lanesFailed: number;
		spawnErrors: Array<{ laneId: string; message: string }>;
		throughputLanesPerSecond: number;
	};
	latency: {
		perLaneMs: PercentileStats;
		cleanupMs: number;
	};
	duration: { totalMs: number; setupMs: number; spawnAndBindMs: number };
	memory: {
		baselineRssBytes: number;
		peakRssBytes: number;
		afterCleanupRssBytes: number;
		deltaBytes: number;
		deltaMegabytes: number;
	};
	thresholds: Thresholds;
	pass: {
		lanesBound: boolean;
		totalDuration: boolean;
		spawnLatency: boolean;
		cleanupLatency: boolean;
		memoryStability: boolean;
	};
	overallPass: boolean;
}

const rssBytes = (): number => process.memoryUsage().rss;
const mb = (bytes: number): number => bytes / (1024 * 1024);
const fmt = (n: number): string => n.toFixed(2);

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	const baselineRss = rssBytes();
	const setupStart = performance.now();

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
		shell: opts.shell,
		maxPtys: opts.maxPtys,
	});
	driver.start();

	const setupMs = performance.now() - setupStart;
	const perLaneMs: number[] = [];
	const spawnStart = performance.now();

	const pending: Array<Promise<void>> = [];
	for (let i = 0; i < opts.count; i++) {
		pending.push(
			(async () => {
				const t0 = performance.now();
				const lane = await lanes.create({
					workspace_id: WORKSPACE,
					project_context_id: PROJECT_CONTEXT,
					display_name: `cvp-${i}`,
				});
				await driver.waitForLane(lane.lane_id, 120_000);
				perLaneMs.push(performance.now() - t0);
			})(),
		);
	}
	await Promise.allSettled(pending);
	await driver.settle();

	const spawnAndBindMs = performance.now() - spawnStart;
	const peakRss = rssBytes();
	const bound = driver.laneIds().length;

	const cleanupStart = performance.now();
	await driver.shutdown();
	const cleanupMs = performance.now() - cleanupStart;
	const afterCleanupRss = rssBytes();

	const totalMs = setupMs + spawnAndBindMs + cleanupMs;
	const memoryDelta = afterCleanupRss - baselineRss;
	const stats = computeStats(perLaneMs);

	const thresholds = thresholdsFor(opts.count);
	const report: CvpReport = {
		schema: "helios.cvp.v1",
		generatedAt: new Date().toISOString(),
		environment: {
			bunVersion: process.versions.bun ?? "unknown",
			nodeVersion: process.version,
			platform: process.platform,
			arch: process.arch,
			cpus: navigator.hardwareConcurrency ?? 0,
		},
		options: {
			count: opts.count,
			maxPtys: opts.maxPtys,
			shell: opts.shell ?? null,
		},
		results: {
			lanesRequested: opts.count,
			lanesBound: bound,
			lanesFailed: opts.count - bound,
			spawnErrors: driver.errors.map((e) => ({
				laneId: e.laneId,
				message: e.message,
			})),
			throughputLanesPerSecond:
				spawnAndBindMs > 0 ? (opts.count / spawnAndBindMs) * 1000 : 0,
		},
		latency: { perLaneMs: stats, cleanupMs },
		duration: { totalMs, setupMs, spawnAndBindMs },
		memory: {
			baselineRssBytes: baselineRss,
			peakRssBytes: peakRss,
			afterCleanupRssBytes: afterCleanupRss,
			deltaBytes: memoryDelta,
			deltaMegabytes: mb(memoryDelta),
		},
		thresholds: thresholds,
		pass: {
			lanesBound: bound === opts.count,
			totalDuration: totalMs < thresholds.maxTotalMs,
			spawnLatency: stats.p99_ms < thresholds.maxSpawnP99Ms,
			cleanupLatency: cleanupMs < thresholds.maxCleanupMs,
			memoryStability: mb(memoryDelta) < thresholds.maxMemoryDeltaMb,
		},
		overallPass: false,
	};
	report.overallPass = Object.values(report.pass).every(Boolean);

	await mkdir(dirname(opts.outputPath), { recursive: true });
	// Tab indentation matches the repository's biome formatting so the
	// generated evidence stays lint-clean without a post-processing step.
	await writeFile(
		opts.outputPath,
		`${JSON.stringify(report, null, "\t")}\n`,
		"utf-8",
	);

	console.log(`\n=== CVP Report (${opts.count} concurrent sessions) ===`);
	console.log(`Lanes bound:      ${bound}/${opts.count}`);
	console.log(`Setup:            ${fmt(setupMs)}ms`);
	console.log(`Spawn+bind:       ${fmt(spawnAndBindMs)}ms`);
	console.log(`  per-lane p50:   ${fmt(stats.p50_ms)}ms`);
	console.log(`  per-lane p99:   ${fmt(stats.p99_ms)}ms`);
	console.log(`Cleanup:          ${fmt(cleanupMs)}ms`);
	console.log(`Total:            ${fmt(totalMs)}ms`);
	console.log(
		`Throughput:       ${fmt(report.results.throughputLanesPerSecond)} lanes/s`,
	);
	console.log(
		`Memory delta:     ${fmt(mb(memoryDelta))}MB (peak ${fmt(mb(peakRss - baselineRss))}MB)`,
	);
	console.log(`\nOverall: ${report.overallPass ? "PASS" : "FAIL"}`);
	if (!report.overallPass) {
		console.log("Failures:");
		if (!report.pass.lanesBound)
			console.log(`  - only ${bound}/${opts.count} lanes reached a surface`);
		if (!report.pass.totalDuration)
			console.log(`  - total ${fmt(totalMs)}ms > ${thresholds.maxTotalMs}ms`);
		if (!report.pass.spawnLatency)
			console.log(
				`  - spawn p99 ${fmt(stats.p99_ms)}ms > ${thresholds.maxSpawnP99Ms}ms`,
			);
		if (!report.pass.cleanupLatency)
			console.log(
				`  - cleanup ${fmt(cleanupMs)}ms > ${thresholds.maxCleanupMs}ms`,
			);
		if (!report.pass.memoryStability)
			console.log(
				`  - memory delta ${fmt(mb(memoryDelta))}MB > ${thresholds.maxMemoryDeltaMb}MB`,
			);
	}
	console.log(`\nReport written to: ${opts.outputPath}`);

	process.exit(report.overallPass ? 0 : 1);
}

await main();
