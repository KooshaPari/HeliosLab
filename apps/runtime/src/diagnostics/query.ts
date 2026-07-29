// FR-007: Metrics query API for retrieving current statistics.

import type { PercentileBucket, Sample } from "./types.js";
import type { MetricsRegistry } from "./metrics.js";
import { computePercentiles } from "./percentiles.js";

/**
 * Read API for retrieving computed statistics from the metrics registry.
 * All query methods are synchronous and target < 1ms latency.
 */
export class MetricsQuery {
  private readonly registry: MetricsRegistry;

  constructor(registry: MetricsRegistry) {
    this.registry = registry;
  }

  /**
   * Compute percentile statistics for a single metric.
   * Returns null if the metric is not registered or has no samples.
   */
  getStats(metric: string): PercentileBucket | null {
    const entry = this.registry.getMetric(metric);
    if (entry === undefined) {
      return null;
    }
    return computePercentiles(entry.buffer.getValues()) ?? null;
  }

  /** Compute percentile statistics for all registered metrics with samples. */
  getAllStats(): Record<string, PercentileBucket> {
    const result: Record<string, PercentileBucket> = {};
    for (const name of this.registry.listMetrics()) {
      const entry = this.registry.getMetric(name);
      if (entry !== undefined) {
        const stats = computePercentiles(entry.buffer.getValues());
        if (stats !== undefined) {
          result[name] = stats;
        }
      }
    }
    return result;
  }

  /**
   * Return recent raw samples from a metric's ring buffer.
   * Returns an empty array if the metric is not found.
   */
  getRawSamples(metric: string, limit?: number): Sample[] {
    const entry = this.registry.getMetric(metric);
    if (entry === undefined) {
      return [];
    }

    const values = entry.buffer.getValues();
    const count = values.length;
    const effectiveLimit = limit !== undefined ? Math.min(limit, count) : count;

    const samples: Sample[] = [];
    // Return the most recent samples (end of the values array).
    const startIdx = count - effectiveLimit;
    for (let i = startIdx; i < count; i++) {
      samples.push({
        timestamp: 0, // Ring buffer doesn't expose per-sample timestamps in getValues
        value: values[i]!,
      });
    }
    return samples;
  }
}
