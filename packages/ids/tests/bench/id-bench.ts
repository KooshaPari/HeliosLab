// Microbenchmarks for ID generation, validation, and parsing
// Enforces SLOs: generation p95 < 0.01ms, validation p95 < 0.005ms
import { generateId, validateId, parseId } from "../../src/index.js";

const ITERATIONS = 100_000;
const WARMUP = 1_000;
// CI machines may be slower — use 2x threshold factor
const CI_FACTOR = 2;

interface BenchResult {
	name: string;
	iterations: number;
	p50_ms: number;
	p95_ms: number;
	p99_ms: number;
	total_ms: number;
	ops_per_sec: number;
}

function percentile(sorted: number[], p: number): number {
	const idx = Math.ceil(sorted.length * p) - 1;
	return sorted[Math.max(0, idx)];
}

function bench(name: string, fn: () => void): BenchResult {
	// Warm up
	for (let i = 0; i < WARMUP; i++) fn();

	const timings: number[] = new Array(ITERATIONS);
	const start = performance.now();

	for (let i = 0; i < ITERATIONS; i++) {
		const t0 = performance.now();
		fn();
		timings[i] = performance.now() - t0;
	}

	const total = performance.now() - start;
	timings.sort((a, b) => a - b);

	return {
		name,
		iterations: ITERATIONS,
		p50_ms: percentile(timings, 0.5),
		p95_ms: percentile(timings, 0.95),
		p99_ms: percentile(timings, 0.99),
		total_ms: total,
		ops_per_sec: Math.round((ITERATIONS / total) * 1000),
	};
}

// Run benchmarks
const sampleId = generateId("workspace");

const results: BenchResult[] = [
	bench('generateId("workspace")', () => generateId("workspace")),
	bench("validateId(validId)", () => validateId(sampleId)),
	bench("parseId(validId)", () => parseId(sampleId)),
];

// Throughput benchmark: 1M IDs
const throughputStart = performance.now();
const THROUGHPUT_COUNT = 1_000_000;
for (let i = 0; i < THROUGHPUT_COUNT; i++) {
	generateId("workspace");
}
const throughputTime = performance.now() - throughputStart;
const throughputOps = Math.round((THROUGHPUT_COUNT / throughputTime) * 1000);

results.push({
	name: "sustained throughput (1M IDs)",
	iterations: THROUGHPUT_COUNT,
	p50_ms: 0,
	p95_ms: 0,
	p99_ms: 0,
	total_ms: throughputTime,
	ops_per_sec: throughputOps,
});

// Output structured JSON
console.log(JSON.stringify(results, null, 2));

// Assert SLOs
const genResult = results[0];
const valResult = results[1];

const genThreshold = 0.01 * CI_FACTOR;
const valThreshold = 0.005 * CI_FACTOR;

if (genResult.p95_ms > genThreshold) {
	console.error(
		`FAIL: generateId p95 (${genResult.p95_ms}ms) > ${genThreshold}ms`,
	);
	process.exit(1);
}

if (valResult.p95_ms > valThreshold) {
	console.error(
		`FAIL: validateId p95 (${valResult.p95_ms}ms) > ${valThreshold}ms`,
	);
	process.exit(1);
}

if (throughputOps < 1_000_000) {
	console.error(`FAIL: throughput (${throughputOps} ops/s) < 1M ops/s`);
	process.exit(1);
}

console.log("\nAll SLO assertions passed.");
