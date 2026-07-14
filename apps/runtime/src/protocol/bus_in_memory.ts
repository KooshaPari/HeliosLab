import { ProtocolValidationError } from "./types.js";
import type { LocalBusEnvelope } from "./types.js";
import { handleInMemoryRequest } from "./bus_in_memory_request.js";
import { validateEnvelope } from "./validator.js";

type LocalBusEnvelopeWithSequence = LocalBusEnvelope & { sequence?: number };

export type AuditRecord = {
  envelope: LocalBusEnvelope;
  outcome: "accepted" | "rejected";
  error?: string;
};

export type MetricSample = {
  metric: string;
  value: number;
  tags?: Record<string, string>;
};

export type MetricSummary = {
  metric: string;
  count: number;
  latest?: number;
  p95?: number;
  p99?: number;
  min?: number;
  max?: number;
};

export type MetricsReport = {
  summaries: MetricSummary[];
  samples?: MetricSample[];
};

export type BusState = {
  session: "attached" | "detached";
  terminal?: "active" | "inactive" | "throttled";
};

const TERMINAL_TOPICS = new Set([
  "session.attached",
  "session.attach.failed",
  "lane.created",
  "lane.create.failed",
  "terminal.spawned",
  "terminal.spawn.failed",
]);

const START_TOPICS = new Set([
  "session.attach.started",
  "lane.create.started",
  "terminal.spawn.started",
]);

export class InMemoryLocalBus {
  private readonly eventLog: LocalBusEnvelope[] = [];
  private readonly auditLog: AuditRecord[] = [];
  private readonly metricsAccumulator: Map<
    string,
    { count: number; latest?: number; values: number[] }
  > = new Map();
  private readonly metricSamples: MetricSample[] = [];
  private state: BusState = { session: "detached" };
  private readonly lifecycleProgress: Map<string, Set<string>> = new Map();
  private rendererEngine: "ghostty" | "rio" = "ghostty";

  getEvents(): LocalBusEnvelope[] {
    return [...this.eventLog];
  }

  /**
   * Push an event directly to the event log without validation.
   * Used by HTTP routing layer for events that don't follow protocol lifecycle ordering.
   */
  pushEvent(event: LocalBusEnvelope): void {
    const sequencedEvent = event as LocalBusEnvelopeWithSequence;
    if (sequencedEvent.sequence === undefined) {
      sequencedEvent.sequence = this.getSequence() + 1;
    }
    this.auditLog.push({ envelope: event, outcome: "accepted" });
    this.eventLog.push(event);
  }

  getAuditRecords(): Promise<AuditRecord[]> {
    return Promise.resolve([...this.auditLog]);
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

  getState(): BusState {
    return { ...this.state };
  }

  private recordMetric(metric: string, value?: number, tags?: Record<string, string>): void {
    const existing = this.metricsAccumulator.get(metric) ?? { count: 0, values: [] };
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
      this.metricSamples.push({ metric, value, ...(tags !== undefined ? { tags } : {}) });
    }
  }

  private emitMetricEvent(metric: string, value?: number): void {
    const seq = this.getSequence() + 1;
    const event: LocalBusEnvelope = {
      id: `metric-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "diagnostics.metric",
      payload: { metric, value },
      sequence: seq,
    };
    this.auditLog.push({ envelope: event, outcome: "accepted" });
    this.eventLog.push(event);
  }

  private getSequence(): number {
    return this.eventLog.filter(e => e.type === "event").length;
  }

  private publishLifecycleEvent(topic: string, envelope: LocalBusEnvelope): void {
    const seq = this.getSequence() + 1;
    const event: LocalBusEnvelope = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      // biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
      ...(envelope.workspace_id !== undefined ? { workspace_id: envelope.workspace_id } : {}),
      // biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
      ...(envelope.lane_id !== undefined ? { lane_id: envelope.lane_id } : {}),
      // biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
      ...(envelope.session_id !== undefined ? { session_id: envelope.session_id } : {}),
      // biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
      ...(envelope.terminal_id !== undefined ? { terminal_id: envelope.terminal_id } : {}),
      // biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
      ...(envelope.correlation_id !== undefined ? { correlation_id: envelope.correlation_id } : {}),
      payload: {},
      sequence: seq,
    };
    this.auditLog.push({ envelope: event, outcome: "accepted" });
    this.eventLog.push(event);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Publish behavior intentionally mirrors protocol lifecycle matrix.
  async publish(event: LocalBusEnvelope): Promise<void> {
    await Promise.resolve();
    try {
      validateEnvelope(event);
    } catch {
      const auditErr = err instanceof ProtocolValidationError ? err.message : String(err);
      this.auditLog.push({ envelope: event, outcome: "rejected", error: auditErr });
      throw err;
    }

    const _topic = event.topic;
    const correlationId = event.correlation_id ?? "";

    if (_topic) {
      const isTerminalTopic = TERMINAL_TOPICS.has(_topic);
      const isStartTopic = START_TOPICS.has(_topic);

      if (isStartTopic) {
        if (!this.lifecycleProgress.has(correlationId)) {
          this.lifecycleProgress.set(correlationId, new Set());
        }
        const progress = this.lifecycleProgress.get(correlationId);
        if (!progress) {
          throw new ProtocolValidationError(
            "ORDERING_VIOLATION",
            `Missing lifecycle progress for correlation "${correlationId}"`
          );
        }
        if (progress.has(_topic)) {
          const err = new ProtocolValidationError(
            "ORDERING_VIOLATION",
            `Duplicate start topic "${_topic}" for correlation "${correlationId}"`
          );
          this.auditLog.push({ envelope: event, outcome: "rejected", error: err.message });
          throw err;
        }
        progress.add(_topic);
        this.auditLog.push({ envelope: event, outcome: "accepted" });
        this.eventLog.push(event);
        return;
      }

      if (isTerminalTopic) {
        const seen = this.lifecycleProgress.get(correlationId);
        const expectedStart = _topic
          .replace(".attached", ".attach.started")
          .replace(
            ".failed",
            _topic.includes("attach")
              ? ".attach.started"
              : _topic.includes("create")
                ? ".create.started"
                : _topic.includes("spawn")
                  ? ".spawn.started"
                  : ""
          )
          .replace(".created", ".create.started")
          .replace(".spawned", ".spawn.started");

        if (!seen?.has(expectedStart) && expectedStart !== _topic) {
          const err = new ProtocolValidationError(
            "ORDERING_VIOLATION",
            `Topic '${_topic}' cannot be published before '${expectedStart}'`
          );
          this.auditLog.push({ envelope: event, outcome: "rejected", error: err.message });
          throw err;
        }
      }

      if (_topic === "terminal.output") {
        const backlogDepth =
          typeof event.payload?.backlog_depth === "number"
            ? event.payload.backlog_depth
            : undefined;
        const tags: Record<string, string> = {};
        if (event.session_id) {
          tags.session_id = event.session_id;
        }
        if (event.lane_id) {
          tags.lane_id = event.lane_id;
        }
        if (event.terminal_id) {
          tags.terminal_id = event.terminal_id;
        }
        this.recordMetric(
          "terminal_output_backlog_depth",
          backlogDepth,
          Object.keys(tags).length > 0 ? tags : undefined
        );
        this.emitMetricEvent("terminal_output_backlog_depth", backlogDepth);
      }
    }

    const sequencedEvent = event as LocalBusEnvelopeWithSequence;
    if (sequencedEvent.sequence === undefined) {
      sequencedEvent.sequence = this.getSequence() + 1;
    }
    this.auditLog.push({ envelope: event, outcome: "accepted" });
    this.eventLog.push(event);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Request semantics require explicit branch coverage.
  async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    return handleInMemoryRequest(
      {
        getState: () => this.getState(),
        setState: state => {
          this.state = state;
        },
        lifecycleProgress: this.lifecycleProgress,
        publishLifecycleEvent: this.publishLifecycleEvent.bind(this),
        recordMetric: this.recordMetric.bind(this),
        emitMetricEvent: this.emitMetricEvent.bind(this),
        getRendererEngine: () => this.rendererEngine,
        setRendererEngine: engine => {
          this.rendererEngine = engine;
        },
      },
      command
    );
  }

  getActiveCorrelationId(): string | undefined {
    return undefined;
  }
}
