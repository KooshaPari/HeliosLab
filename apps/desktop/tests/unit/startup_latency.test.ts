import { expect, test } from "bun:test";
import { createRuntime } from "../../../runtime/src";
import { bootDesktop } from "../../src";

const ITERATIONS = 25;
const STARTUP_P95_MS = 2_000;

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length + 1)) - 1));
  return sorted[index]!;
}

test("startup latency stays within the local interactive target", async () => {
  const timings: number[] = [];

  for (let index = 0; index < ITERATIONS; index++) {
    const startedAt = performance.now();
    const runtime = createRuntime();
    const controlPlane = bootDesktop({ bus: runtime.bus });

    timings.push(performance.now() - startedAt);
    expect(controlPlane.getTabs().terminal.title.length).toBeGreaterThan(0);

    await runtime.shutdown();
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);

  console.log(
    JSON.stringify({
      benchmark: "desktop-startup-latency",
      iterations: ITERATIONS,
      p50_ms: percentile(sorted, 0.5),
      p95_ms: p95,
      max_ms: sorted[sorted.length - 1],
    })
  );

  expect(p95).toBeLessThan(STARTUP_P95_MS);
});
