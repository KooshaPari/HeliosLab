/**
 * FR-HELIOS-095: Feature Flag Performance Benchmarks
 * Verifies: FR-CFG-001 (Feature flag read/write latency)
 * @Benchmarks
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonSettingsStore } from "../../../src/config/store.js";
import { SETTINGS_SCHEMA } from "../../../src/config/schema.js";
import { SettingsManager } from "../../../src/config/settings.js";
import { FlagRegistry, RENDERER_ENGINE_FLAG } from "../../../src/config/flags.js";

// CI slowdown factor — 2x threshold multiplier
const CI_FACTOR = process.env["CI"] ? 2 : 1;

interface BenchResult {
  name: string;
  iterations: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  pass: boolean;
  threshold_p95_ms: number;
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

async function setup() {
  const tempDir = await mkdtemp(join(tmpdir(), "flags-bench-"));
  const filePath = join(tempDir, "settings.json");
  const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
  const settings = new SettingsManager(SETTINGS_SCHEMA, store);
  await settings.init();
  const flags = new FlagRegistry(settings);
  flags.register(RENDERER_ENGINE_FLAG);
  flags.init();
  return { tempDir, settings, flags };
}

async function teardown(tempDir: string, settings: SettingsManager, flags: FlagRegistry) {
  flags.dispose();
  settings.dispose();
  await rm(tempDir, { recursive: true, force: true });
}

// ── Benchmark 1: Flag read latency ────────────────────────────────────

async function benchFlagRead(): Promise<BenchResult> {
  const { tempDir, settings, flags } = await setup();
  const iterations = 100_000;
  const warmup = 10_000;

  // Warm-up phase
  for (let i = 0; i < warmup; i++) {
    flags.get("renderer_engine");
  }

  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    flags.get("renderer_engine");
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  const threshold = 0.01 * CI_FACTOR;
  const p95 = percentile(latencies, 95);

  await teardown(tempDir, settings, flags);

  return {
    name: "flag_read_latency",
    iterations,
    p50_ms: percentile(latencies, 50),
    p95_ms: p95,
    p99_ms: percentile(latencies, 99),
    pass: p95 < threshold,
    threshold_p95_ms: threshold,
  };
}

// ── Benchmark 2: Settings write latency ───────────────────────────────

async function benchSettingsWrite(): Promise<BenchResult> {
  const { tempDir, settings, flags } = await setup();
  const iterations = 1_000;
  const warmup = 50;

  // Warm-up
  for (let i = 0; i < warmup; i++) {
    await settings.set("theme", i % 2 === 0 ? "dark" : "light");
  }

  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const value = i % 2 === 0 ? "dark" : "light";
    const start = performance.now();
    await settings.set("theme", value);
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  const threshold = 50 * CI_FACTOR;
  const p95 = percentile(latencies, 95);

  await teardown(tempDir, settings, flags);

  return {
    name: "settings_write_latency",
    iterations,
    p50_ms: percentile(latencies, 50),
    p95_ms: p95,
    p99_ms: percentile(latencies, 99),
    pass: p95 < threshold,
    threshold_p95_ms: threshold,
  };
}

// ── Benchmark 3: Hot-reload propagation ───────────────────────────────

async function benchHotReloadPropagation(): Promise<BenchResult> {
  const { tempDir, settings, flags } = await setup();
  // Register theme as a hot-reloadable flag
  flags.register({
    key: "theme",
    defaultValue: "system",
    description: "Theme",
  });
  flags.dispose();
  flags.init();

  const iterations = 500;
  const warmup = 20;

  // Warm-up
  for (let i = 0; i < warmup; i++) {
    await settings.set("theme", i % 2 === 0 ? "dark" : "light");
  }

  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const value = i % 2 === 0 ? "dark" : "light";
    const start = performance.now();
    await settings.set("theme", value);
    // Propagation is synchronous via listener — measure until flag reflects change
    const _ = flags.get("theme");
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  const threshold = 500 * CI_FACTOR;
  const p95 = percentile(latencies, 95);

  await teardown(tempDir, settings, flags);

  return {
    name: "hot_reload_propagation",
    iterations,
    p50_ms: percentile(latencies, 50),
    p95_ms: p95,
    p99_ms: percentile(latencies, 99),
    pass: p95 < threshold,
    threshold_p95_ms: threshold,
  };
}

// ── Benchmark 4: Flag read memory (zero-allocation check) ────────────

async function benchFlagReadMemory(): Promise<BenchResult> {
  const { tempDir, settings, flags } = await setup();
  const iterations = 100_000;

  // Warm-up
  for (let i = 0; i < 10_000; i++) {
    flags.get("renderer_engine");
  }

  // Force GC if available, then measure heap before/after
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }

  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) {
    flags.get("renderer_engine");
  }
  const heapAfter = process.memoryUsage().heapUsed;

  const heapDelta = heapAfter - heapBefore;
  // Allow small noise — threshold: < 1 byte per read on average
  const bytesPerRead = Math.max(0, heapDelta) / iterations;
  const pass = bytesPerRead < 1;

  await teardown(tempDir, settings, flags);

  return {
    name: "flag_read_memory",
    iterations,
    p50_ms: 0,
    p95_ms: bytesPerRead,
    p99_ms: 0,
    pass,
    threshold_p95_ms: 1, // bytes per read, not ms
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const results: BenchResult[] = [];

  results.push(await benchFlagRead());
  results.push(await benchSettingsWrite());
  results.push(await benchHotReloadPropagation());
  results.push(await benchFlagReadMemory());

  // Structured JSON output for CI
  console.log(JSON.stringify({ benchmarks: results }, null, 2));

  // Assert thresholds
  const failures = results.filter(r => !r.pass);
  if (failures.length > 0) {
    console.error("\nBenchmark threshold breaches:");
    for (const f of failures) {
      console.error(
        `  FAIL: ${f.name} — p95=${f.p95_ms.toFixed(4)} > threshold=${f.threshold_p95_ms}`
      );
    }
    process.exit(1);
  }

  console.log("\nAll benchmarks passed.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
