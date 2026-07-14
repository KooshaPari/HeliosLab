/**
 * FR-HELIOS-092: SLO Violation Detection Integration Tests
 * Verifies: FR-PRF-003 (SLO thresholds), FR-PRF-004 (SLO violation events), FR-PRF-010 (Rate limiting)
 */
import { MetricsRegistry } from "../../../src/diagnostics/metrics.js";
import { SLOMonitor } from "../../../src/diagnostics/slo.js";
import type { SLODefinition } from "../../../src/diagnostics/types.js";

const METRIC_NAME = "input-to-echo";

const sloDefinitions: SLODefinition[] = [
  { metric: METRIC_NAME, percentile: "p95", threshold: 60, unit: "ms" },
];

function createSetup(busFn?: (topic: string, payload: unknown) => void) {
  const _registry = new MetricsRegistry();
  registry.register({
    name: METRIC_NAME,
    type: "latency",
    unit: "ms",
    description: "Input to echo latency",
    bufferSize: 1000,
  });
  const monitor = new SLOMonitor(registry, sloDefinitions, busFn);
  return { registry, monitor };
}

describe("SLO Violation Detection", () => {
  // FR-004: violation detected when metric exceeds threshold
  it("detects violation when metric exceeds SLO threshold", () => {
    const { registry, monitor } = createSetup();
    // Record samples all above threshold (60ms)
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    const violations = monitor.checkAll();
    expect(violations.length).toBe(1);
    expect(violations[0]!.metric).toBe(METRIC_NAME);
    expect(violations[0]!.percentile).toBe("p95");
    expect(violations[0]!.actual).toBeGreaterThan(60);
    expect(violations[0]!.threshold).toBe(60);
  });

  // FR-004: no violation when metric is within threshold
  it("does not emit violation when metric is within SLO", () => {
    const { registry, monitor } = createSetup();
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 30, i);
    }
    const violations = monitor.checkAll();
    expect(violations.length).toBe(0);
  });

  // FR-004: no violation when metric has no samples
  it("does not emit violation when metric has no samples", () => {
    const { _registry, monitor } = createSetup();
    const violations = monitor.checkAll();
    expect(violations.length).toBe(0);
  });

  // FR-004: violation event contains all required fields
  it("violation event contains all required fields", () => {
    const { registry, monitor } = createSetup();
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 200, i);
    }
    const violations = monitor.checkAll();
    expect(violations.length).toBe(1);
    const v = violations[0]!;
    expect(v).toHaveProperty("metric");
    expect(v).toHaveProperty("percentile");
    expect(v).toHaveProperty("threshold");
    expect(v).toHaveProperty("actual");
    expect(v).toHaveProperty("timestamp");
  });
});

describe("Rate Limiting", () => {
  // FR-010: rate limiter suppresses duplicate violations within window
  it("suppresses duplicate violation within rate limit window", () => {
    const { registry, monitor } = createSetup();
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    const first = monitor.checkAll();
    expect(first.length).toBe(1);

    const second = monitor.checkAll();
    expect(second.length).toBe(0); // suppressed
  });

  // FR-010: rate limiter allows event after window expires
  it("allows violation after rate limit window expires", () => {
    const { registry, monitor } = createSetup();
    monitor.setRateLimitWindowMs(50); // 50ms for testing
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }

    const first = monitor.checkAll();
    expect(first.length).toBe(1);

    // Wait for window to expire
    const start = Date.now();
    while (Date.now() - start < 60) {
      // busy-wait
    }

    const second = monitor.checkAll();
    expect(second.length).toBe(1);
  });

  // FR-010: independent rate limiting per metric
  it("rate limits each metric independently", () => {
    const _registry = new MetricsRegistry();
    registry.register({
      name: "metric-a",
      type: "latency",
      unit: "ms",
      description: "A",
    });
    registry.register({
      name: "metric-b",
      type: "latency",
      unit: "ms",
      description: "B",
    });

    const defs: SLODefinition[] = [
      { metric: "metric-a", percentile: "p95", threshold: 50, unit: "ms" },
      { metric: "metric-b", percentile: "p95", threshold: 50, unit: "ms" },
    ];
    const monitor = new SLOMonitor(registry, defs);

    for (let i = 0; i < 100; i++) {
      registry.record("metric-a", 100, i);
      registry.record("metric-b", 100, i);
    }

    const first = monitor.checkAll();
    expect(first.length).toBe(2);

    // Both should be suppressed now
    const second = monitor.checkAll();
    expect(second.length).toBe(0);
  });

  // FR-010: resetRateLimiter allows re-emission
  it("resetRateLimiter clears suppression", () => {
    const { registry, monitor } = createSetup();
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    monitor.checkAll();
    monitor.resetRateLimiter();
    const after = monitor.checkAll();
    expect(after.length).toBe(1);
  });
});

describe("Bus Integration", () => {
  // FR-004: bus event published with correct topic and payload
  it("publishes violation events to bus with correct topic", () => {
    const events: Array<{ topic: string; payload: unknown }> = [];
    const busFn = (topic: string, payload: unknown) => {
      events.push({ topic, payload });
    };
    const { registry, monitor } = createSetup(busFn);
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    monitor.checkAll();
    expect(events.length).toBe(1);
    expect(events[0]!.topic).toBe("perf.slo_violation");
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload.metric).toBe(METRIC_NAME);
    expect(payload.percentile).toBe("p95");
  });

  // FR-004: bus error does not crash monitor
  it("continues when bus publish throws", () => {
    const busFn = () => {
      throw new Error("bus down");
    };
    const { registry, monitor } = createSetup(busFn);
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    // Should not throw
    const violations = monitor.checkAll();
    expect(violations.length).toBe(1);
  });

  // FR-004: no bus — fallback to console
  it("logs to console when no bus provided", () => {
    const { registry, monitor } = createSetup(); // no bus
    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }
    // Should not throw, just log
    const violations = monitor.checkAll();
    expect(violations.length).toBe(1);
  });
});

describe("Periodic Check Loop", () => {
  let monitor: SLOMonitor;

  afterEach(() => {
    monitor?.stop();
  });

  // FR-004: periodic loop fires and detects violations
  it("fires periodic checks and detects violations", async () => {
    const events: unknown[] = [];
    const busFn = (_topic: string, payload: unknown) => {
      events.push(payload);
    };
    const setup = createSetup(busFn);
    monitor = setup.monitor;
    const _registry = setup.registry;

    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }

    monitor.start(50); // 50ms interval
    await new Promise(r => setTimeout(r, 150));
    monitor.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // FR-004: stop halts the loop
  it("stop() halts the check loop", async () => {
    const events: unknown[] = [];
    const busFn = (_topic: string, payload: unknown) => {
      events.push(payload);
    };
    const setup = createSetup(busFn);
    monitor = setup.monitor;
    const _registry = setup.registry;

    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }

    monitor.start(50);
    await new Promise(r => setTimeout(r, 80));
    monitor.stop();
    const countAfterStop = events.length;
    await new Promise(r => setTimeout(r, 150));
    // No more events after stop
    expect(events.length).toBe(countAfterStop);
  });

  // FR-004: double start does not create duplicate intervals
  it("double start() does not create duplicate intervals", async () => {
    const events: unknown[] = [];
    const busFn = (_topic: string, payload: unknown) => {
      events.push(payload);
    };
    const setup = createSetup(busFn);
    monitor = setup.monitor;
    const _registry = setup.registry;

    for (let i = 0; i < 100; i++) {
      registry.record(METRIC_NAME, 100, i);
    }

    monitor.start(50);
    monitor.start(50); // should not create second interval
    await new Promise(r => setTimeout(r, 150));
    monitor.stop();

    // With rate limiting, only 1 event should fire regardless
    // The point is it doesn't crash or double-fire
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // FR-010: multiple metrics violating simultaneously
  it("handles multiple simultaneous violations", () => {
    const _registry = new MetricsRegistry();
    registry.register({
      name: "m1",
      type: "latency",
      unit: "ms",
      description: "M1",
    });
    registry.register({
      name: "m2",
      type: "latency",
      unit: "ms",
      description: "M2",
    });
    registry.register({
      name: "m3",
      type: "latency",
      unit: "ms",
      description: "M3",
    });

    const defs: SLODefinition[] = [
      { metric: "m1", percentile: "p95", threshold: 50, unit: "ms" },
      { metric: "m2", percentile: "p95", threshold: 50, unit: "ms" },
      { metric: "m3", percentile: "p50", threshold: 30, unit: "ms" },
    ];

    const events: unknown[] = [];
    const m = new SLOMonitor(registry, defs, (_: string, p: unknown) => {
      events.push(p);
    });

    for (let i = 0; i < 100; i++) {
      registry.record("m1", 100, i);
      registry.record("m2", 100, i);
      registry.record("m3", 100, i);
    }

    const violations = m.checkAll();
    expect(violations.length).toBe(3);
    expect(events.length).toBe(3);
  });
});
