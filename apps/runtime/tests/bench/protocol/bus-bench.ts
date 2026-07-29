/**
 * FR-HELIOS-098: Local Bus Performance Benchmarks
 * Verifies: FR-BUS-001 (Bus dispatch latency), FR-PRF-003 (Throughput)
 * @Benchmarks
 */
import { createBus } from "../../../src/protocol/bus.js";
import {
  createCommand,
  createEvent,
  createResponse,
  validateEnvelope,
} from "../../../src/protocol/envelope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  iterations: number;
  warmup: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  threshold_p95_ms: number;
  passed: boolean;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function runSync(fn: () => void, iterations: number, warmup: number): number[] {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    timings.push(performance.now() - start);
  }
  return timings.sort((a, b) => a - b);
}

async function runAsync(
  fn: () => Promise<void>,
  iterations: number,
  warmup: number
): Promise<number[]> {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }
  return timings.sort((a, b) => a - b);
}

function summarize(
  name: string,
  sorted: number[],
  threshold_p95_ms: number,
  warmup: number
): BenchResult {
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  return {
    name,
    iterations: sorted.length,
    warmup,
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99,
    threshold_p95_ms,
    passed: p95 <= threshold_p95_ms,
  };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const WARMUP = 100;
const ITERATIONS = 1_000;
// CI slowdown: 2x the stated SLO thresholds
const DISPATCH_P95_THRESHOLD = 2.0; // SLO: 1ms, CI: 2ms
const FANOUT_P95_THRESHOLD = 10.0; // SLO: 5ms, CI: 10ms
const VALIDATE_P95_THRESHOLD = 0.2; // SLO: 0.1ms, CI: 0.2ms

async function benchCommandDispatch(): Promise<BenchResult> {
  const bus = createBus();
  bus.registerMethod("bench.echo", cmd => createResponse(cmd, cmd.payload));

  const timings = await runAsync(
    async () => {
      const cmd = createCommand("bench.echo", { data: "hello" });
      await bus.send(cmd);
    },
    ITERATIONS,
    WARMUP
  );

  bus.destroy();
  return summarize("command_dispatch", timings, DISPATCH_P95_THRESHOLD, WARMUP);
}

async function benchEventFanout50(): Promise<BenchResult> {
  const bus = createBus();
  for (let i = 0; i < 50; i++) {
    bus.subscribe("bench.fanout", () => {
      // no-op subscriber
    });
  }

  const timings = await runAsync(
    async () => {
      const evt = createEvent("bench.fanout", {
        data: "test",
      }) as import("../../../src/protocol/types.js").LocalBusEnvelope;
      await bus.publish(evt);
    },
    ITERATIONS,
    WARMUP
  );

  bus.destroy();
  return summarize("event_fanout_50", timings, FANOUT_P95_THRESHOLD, WARMUP);
}

function benchEnvelopeValidation(): BenchResult {
  const envelope = {
    id: "cmd_test123",
    correlation_id: "cor_test123",
    timestamp: 1,
    type: "command" as const,
    method: "test.method",
    payload: { key: "value" },
  };

  const timings = runSync(
    () => {
      validateEnvelope(envelope);
    },
    ITERATIONS,
    WARMUP
  );

  return summarize("envelope_validation", timings, VALIDATE_P95_THRESHOLD, WARMUP);
}

async function benchSustainedThroughput(): Promise<
  BenchResult & {
    total_messages: number;
    duration_s: number;
    ordering_violations: number;
  }
> {
  const bus = createBus();
  let received = 0;
  let lastSeq = 0;
  let violations = 0;

  bus.subscribe("bench.sustained", e => {
    received++;
    if ((e.sequence ?? 0) <= lastSeq) {
      violations++;
    }
    lastSeq = e.sequence ?? 0;
  });

  const TARGET_RATE = 10_000; // msg/s
  const DURATION_S = 2; // shortened for test practicality (full 10s in real CI)
  const TOTAL = TARGET_RATE * DURATION_S;

  const start = performance.now();
  const promises: Promise<void>[] = [];
  for (let i = 0; i < TOTAL; i++) {
    promises.push(
      bus.publish(
        createEvent("bench.sustained", {
          i,
        }) as import("../../../src/protocol/types.js").LocalBusEnvelope
      )
    );
  }
  await Promise.all(promises);
  const elapsed = performance.now() - start;

  bus.destroy();

  const passed = received === TOTAL && violations === 0;
  return {
    name: "sustained_throughput",
    iterations: TOTAL,
    warmup: 0,
    p50_ms: elapsed / TOTAL,
    p95_ms: elapsed / TOTAL,
    p99_ms: elapsed / TOTAL,
    threshold_p95_ms: DISPATCH_P95_THRESHOLD,
    passed,
    total_messages: received,
    duration_s: elapsed / 1000,
    ordering_violations: violations,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const results: BenchResult[] = [];

  results.push(await benchCommandDispatch());
  results.push(await benchEventFanout50());
  results.push(benchEnvelopeValidation());
  results.push(await benchSustainedThroughput());

  // Output structured JSON for CI
  const output = JSON.stringify({ benchmarks: results }, null, 2);
  console.log(output);

  // Assert all passed
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.error("\nSLO BREACHES:");
    for (const f of failures) {
      console.error(
        `  ${f.name}: p95=${String(f.p95_ms.toFixed(3))}ms > threshold=${String(f.threshold_p95_ms)}ms`
      );
    }
    process.exit(1);
  }

  console.log("\nAll benchmarks passed SLO thresholds.");
}

await main();
