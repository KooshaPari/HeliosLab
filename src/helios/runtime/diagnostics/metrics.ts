export type RuntimeMetricName =
  | "lane_create_latency_ms"
  | "session_restore_latency_ms"
  | "terminal_output_backlog_depth";

export type RuntimeMetricSample = {
  metric: RuntimeMetricName;
  value: number;
  unit: "ms" | "count";
  ts: string;
  tags?: Record<string, string>;
};

export type RuntimeMetricSummary = {
  metric: RuntimeMetricName;
  unit: "ms" | "count";
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  latest: number;
};

export type RuntimeMetricsReport = {
  samples: RuntimeMetricSample[];
  summaries: RuntimeMetricSummary[];
};

type MetricUnit = RuntimeMetricSample["unit"];

type TimerMark = {
  startAtMs: number;
  tags?: Record<string, string>;
};

export class RuntimeMetrics {
  private readonly samples: RuntimeMetricSample[] = [];
  private readonly timers = new Map<string, TimerMark>();

  startTimer(metric: RuntimeMetricName, key: string, tags?: Record<string, string>): void {
    this.timers.set(this.timerKey(metric, key), { startAtMs: Date.now(), tags });
  }

  endTimer(
    metric: RuntimeMetricName,
    key: string,
    tags?: Record<string, string>,
  ): RuntimeMetricSample | null {
    const timerId = this.timerKey(metric, key);
    const mark = this.timers.get(timerId);
    if (!mark) {
      return null;
    }
    this.timers.delete(timerId);
    const value = Math.max(0, Date.now() - mark.startAtMs);
    return this.record(metric, value, "ms", { ...mark.tags, ...tags });
  }

  record(
    metric: RuntimeMetricName,
    value: number,
    unit: MetricUnit,
    tags?: Record<string, string>,
  ): RuntimeMetricSample {
    const sample: RuntimeMetricSample = {
      metric,
      value,
      unit,
      ts: new Date().toISOString(),
      tags,
    };
    this.samples.push(sample);
    return sample;
  }

  getReport(): RuntimeMetricsReport {
    const byMetric = new Map<RuntimeMetricName, RuntimeMetricSample[]>();
    for (const sample of this.samples) {
      const items = byMetric.get(sample.metric);
      if (items) {
        items.push(sample);
      } else {
        byMetric.set(sample.metric, [sample]);
      }
    }

    const summaries: RuntimeMetricSummary[] = [];
    for (const [metric, items] of byMetric.entries()) {
      const sortedValues = items.map((item) => item.value).sort((a, b) => a - b);
      const unit = items[0].unit;
      summaries.push({
        metric,
        unit,
        count: sortedValues.length,
        min: sortedValues[0],
        max: sortedValues[sortedValues.length - 1],
        p50: percentile(sortedValues, 0.5),
        p95: percentile(sortedValues, 0.95),
        latest: items[items.length - 1].value,
      });
    }

    summaries.sort((a, b) => a.metric.localeCompare(b.metric));
    return {
      samples: [...this.samples],
      summaries,
    };
  }

  private timerKey(metric: RuntimeMetricName, key: string): string {
    return `${metric}:${key}`;
  }
}

function percentile(sortedValues: number[], rank: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const index = Math.ceil(sortedValues.length * rank) - 1;
  const boundedIndex = Math.min(sortedValues.length - 1, Math.max(0, index));
  return sortedValues[boundedIndex];
}
