import type { MetricSample, MetricSummary, MetricsReport } from "./types.js";
import type { LocalBusEnvelope } from "../types.js";

// ---------------------------------------------------------------------------
// Metrics Accumulator and Recorder
// ---------------------------------------------------------------------------

export type MetricsAccumulator = Map<string, { count: number; latest?: number; values: number[] }>;

export class MetricsRecorder {
  private metricsAccumulator: MetricsAccumulator = new Map();
  private metricSamples: MetricSample[] = [];

  recordMetric(metric: string, value?: number, tags?: Record<string, string>): void {
    const existing = this.metricsAccumulator.get(metric) ?? {
      count: 0,
      values: [],
    };
    const latestValue = value !== undefined ? value : existing.latest;
    const updated = {
      count: existing.count + 1,
      ...(latestValue !== undefined ? { latest: latestValue } : {}),
      values: existing.values,
    };
    if (value !== undefined) {
      updated.values.push(value);
    }
    this.metricsAccumulator.set(metric, updated);
    if (value !== undefined) {
      this.metricSamples.push({
        metric,
        value,
        ...(tags !== undefined ? { tags } : {}),
      });
    }
  }

  emitMetricEvent(
    metric: string,
    value: number | undefined,
    eventLog: LocalBusEnvelope[],
    auditLog: Array<{
      envelope: LocalBusEnvelope;
      outcome: "accepted" | "rejected";
      error?: string;
    }>
  ): void {
    const seq = eventLog.filter(e => e.type === "event").length + 1;
    const event: LocalBusEnvelope = {
      id: `metric-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "diagnostics.metric",
      payload: { metric, value },
      sequence: seq,
    };
    auditLog.push({ envelope: event, outcome: "accepted" });
    eventLog.push(event);
  }

  getMetricsReport(): MetricsReport {
    const summaries: MetricSummary[] = [];
    for (const [metric, data] of this.metricsAccumulator) {
      const summary: MetricSummary = {
        metric,
        count: data.count,
        ...(data.latest !== undefined ? { latest: data.latest } : {}),
      };
      if (data.values.length > 0) {
        const sorted = [...data.values].sort((a, b) => a - b);
        const p95Idx = Math.ceil(0.95 * sorted.length) - 1;
        const p99Idx = Math.ceil(0.99 * sorted.length) - 1;
        summary.p95 = sorted[Math.max(0, p95Idx)];
        summary.p99 = sorted[Math.max(0, p99Idx)];
        summary.min = sorted[0];
        summary.max = sorted[sorted.length - 1];
      }
      summaries.push(summary);
    }
    return { summaries, samples: [...this.metricSamples] };
  }
}
