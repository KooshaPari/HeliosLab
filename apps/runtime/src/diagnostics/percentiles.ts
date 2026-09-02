// FR-002: Rolling percentile computation over ring buffer values.

import type { PercentileBucket } from "./types.js";

/**
 * Compute percentile statistics from a Float64Array of values.
 * Uses the nearest-rank method. Returns undefined if values is empty.
 *
 * The input array is **not** mutated — a sorted copy is created internally.
 */
export function computePercentiles(values: Float64Array): PercentileBucket | undefined {
  const count = values.length;
  if (count === 0) {
    return undefined;
  }

  // Sort a copy (Float64Array.prototype.sort is in-place).
  const sorted = new Float64Array(values);
  sorted.sort();

  return {
    p50: percentileFromSorted(sorted, 0.5),
    p95: percentileFromSorted(sorted, 0.95),
    p99: percentileFromSorted(sorted, 0.99),
    min: sorted[0]!,
    max: sorted[count - 1]!,
    count,
  };
}

/** Nearest-rank percentile on a pre-sorted Float64Array. */
function percentileFromSorted(sorted: Float64Array, p: number): number {
  const index = Math.ceil(p * sorted.length);
  return sorted[Math.min(index, sorted.length - 1)]!;
}
