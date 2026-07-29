// FR-001: Core metric and sample type definitions for the instrumentation layer.

/** Supported metric types. */
export type MetricType = "latency" | "gauge" | "counter";

/** Describes a metric that can be registered with the MetricsRegistry. */
export interface MetricDefinition {
  readonly name: string;
  readonly type: MetricType;
  readonly unit: string;
  readonly description: string;
  readonly bufferSize?: number | undefined;
}

/**
 * A single recorded sample.
 * `labels` is optional — omit on hot paths to avoid allocation.
 */
export interface Sample {
  readonly timestamp: number;
  readonly value: number;
  readonly labels?: Record<string, string> | undefined;
}

/** Pre-computed percentile statistics for a metric's sample buffer. */
export interface PercentileBucket {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/** Definition of a Service Level Objective threshold. */
export interface SLODefinition {
  readonly metric: string;
  readonly percentile: "p50" | "p95" | "p99";
  readonly threshold: number;
  readonly unit: string;
}

/** Emitted when an SLO threshold is breached. */
export interface SLOViolationEvent {
  readonly metric: string;
  readonly percentile: string;
  readonly threshold: number;
  readonly actual: number;
  readonly timestamp: number;
}
