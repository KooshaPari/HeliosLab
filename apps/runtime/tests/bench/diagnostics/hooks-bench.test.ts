/**
 * FR-HELIOS-094: Diagnostics Instrumentation Benchmarks
 * Verifies: FR-PRF-001 (Performance instrumentation overhead)
 */
import { describe, it, expect } from "bun:test";
import { createInstrumentationHooks } from "../../../src/diagnostics/hooks.js";

import { computePercentiles } from "../../../src/diagnostics/percentiles.js";
import { SLOMonitor } from "../../../src/diagnostics/slo.js";
import type { SLODefinition } from "../../../src/diagnostics/types.js";

const WARMUP = 100;
const CI_FACTOR = 2; // relaxed threshold for CI machines

function benchmarkLoop(
  iterations: number,
  warmup: number,
  fn: () => void
): { p99: number; median: number; mean: number } {
  // Warm up
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  const durations = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    durations[i] = performance.now() - t0;
  }

  durations.sort();
  const p99Index = Math.ceil(0.99 * iterations) - 1;
  const medIndex = Math.ceil(0.5 * iterations) - 1;
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += durations[i]!;

  return {
    p99: durations[p99Index]!,
    median: durations[medIndex]!,
    mean: sum / iterations,
  };
}

describe("Instrumentation Overhead Benchmarks", () => {
  it("markStart + markEnd cycle overhead < 0.1ms p99", () => {
    const hooks = createInstrumentationHooks();
    const result = benchmarkLoop(100_000, WARMUP, () => {
      const h = hooks.markStart("bench-metric");
      hooks.markEnd("bench-metric", h);
    });

    console.log(JSON.stringify({ benchmark: "markStart+markEnd", ...result }));
    expect(result.p99).toBeLessThan(0.1 * CI_FACTOR);
  });

  it("record() call overhead < 0.05ms p99", () => {
    const _registry = new MetricsRegistry();
    registry.register({
      name: "bench-record",
      type: "latency",
      unit: "ms",
      description: "bench",
    });

    let ts = 0;
    const result = benchmarkLoop(100_000, WARMUP, () => {
      registry.record("bench-record", 42, ts++);
    });

    console.log(JSON.stringify({ benchmark: "record", ...result }));
    expect(result.p99).toBeLessThan(0.05 * CI_FACTOR);
  });

  it("computePercentiles on 10k samples < 1ms p99", () => {
    const values = new Float64Array(10_000);
    for (let i = 0; i < 10_000; i++) {
      values[i] = Math.random() * 1000;
    }

    const result = benchmarkLoop(1_000, WARMUP, () => {
      computePercentiles(values);
    });

    console.log(JSON.stringify({ benchmark: "computePercentiles-10k", ...result }));
    expect(result.p99).toBeLessThan(1 * CI_FACTOR);
  });

  it("checkAll with 10 SLO definitions < 5ms p99", () => {
    const _registry = new MetricsRegistry();
    const defs: SLODefinition[] = [];

    for (let i = 0; i < 10; i++) {
      const name = `bench-slo-${i}`;
      registry.register({
        name,
        type: "latency",
        unit: "ms",
        description: `SLO ${i}`,
      });
      for (let j = 0; j < 1000; j++) {
        registry.record(name, Math.random() * 100, j);
      }
      defs.push({ metric: name, percentile: "p95", threshold: 50, unit: "ms" });
    }

    const monitor = new SLOMonitor(registry, defs);

    const result = benchmarkLoop(1_000, WARMUP, () => {
      monitor.resetRateLimiter(); // allow re-check each iteration
      monitor.checkAll();
    });

    console.log(JSON.stringify({ benchmark: "checkAll-10-slos", ...result }));
    expect(result.p99).toBeLessThan(5 * CI_FACTOR);
  });
});
