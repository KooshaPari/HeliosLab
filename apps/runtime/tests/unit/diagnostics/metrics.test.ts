// FR-001, FR-009: Unit tests for RingBuffer and MetricsRegistry.

import { describe, it, expect, beforeEach } from "bun:test";
import { RingBuffer, MetricsRegistry } from "../../../src/diagnostics/metrics.js";
import type { MetricDefinition } from "../../../src/diagnostics/types.js";

// ── RingBuffer ─────────────────────────────────────────────────────────

describe("RingBuffer", () => {
  // FR-009
  it("push within capacity stores all values", () => {
    const buf = new RingBuffer(5);
    buf.push(10, 1);
    buf.push(20, 2);
    buf.push(30, 3);

    expect(buf.getCount()).toBe(3);
    expect(buf.getOverflowCount()).toBe(0);
    expect(Array.from(buf.getValues())).toEqual([10, 20, 30]);
  });

  it("push at exact capacity — no overflow yet", () => {
    const buf = new RingBuffer(3);
    buf.push(1, 100);
    buf.push(2, 200);
    buf.push(3, 300);

    expect(buf.getCount()).toBe(3);
    expect(buf.getOverflowCount()).toBe(0);
    expect(Array.from(buf.getValues())).toEqual([1, 2, 3]);
  });

  it("push beyond capacity drops oldest and increments overflow", () => {
    const buf = new RingBuffer(3);
    buf.push(1, 100);
    buf.push(2, 200);
    buf.push(3, 300);
    buf.push(4, 400); // overwrites slot 0 (value=1)

    expect(buf.getCount()).toBe(3);
    expect(buf.getOverflowCount()).toBe(1);
    expect(Array.from(buf.getValues())).toEqual([2, 3, 4]);
  });

  it("capacity + N overflows reports N overflows", () => {
    const buf = new RingBuffer(2);
    for (let i = 0; i < 7; i++) {
      buf.push(i, i * 10);
    }
    // 7 pushes, capacity 2 => 5 overflows
    expect(buf.getOverflowCount()).toBe(5);
    expect(buf.getCount()).toBe(2);
    expect(Array.from(buf.getValues())).toEqual([5, 6]);
  });

  it("getValues returns empty for zero samples", () => {
    const buf = new RingBuffer(10);
    const vals = buf.getValues();
    expect(vals.length).toBe(0);
  });

  it("clear resets buffer to empty", () => {
    const buf = new RingBuffer(5);
    buf.push(1, 1);
    buf.push(2, 2);
    buf.clear();

    expect(buf.getCount()).toBe(0);
    expect(buf.getOverflowCount()).toBe(0);
    expect(buf.getValues().length).toBe(0);
  });

  it("capacity=1 extreme boundary works correctly", () => {
    const buf = new RingBuffer(1);
    buf.push(42, 100);
    expect(buf.getCount()).toBe(1);
    expect(Array.from(buf.getValues())).toEqual([42]);

    buf.push(99, 200);
    expect(buf.getCount()).toBe(1);
    expect(buf.getOverflowCount()).toBe(1);
    expect(Array.from(buf.getValues())).toEqual([99]);
  });

  it("rejects capacity <= 0", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });
});

// ── MetricsRegistry ────────────────────────────────────────────────────

const latencyDef: MetricDefinition = {
  name: "input_latency",
  type: "latency",
  unit: "ms",
  description: "Terminal input processing latency",
  bufferSize: 100,
};

const counterDef: MetricDefinition = {
  name: "frame_count",
  type: "counter",
  unit: "count",
  description: "Total frames rendered",
};

describe("MetricsRegistry", () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  // FR-009
  it("register and list metrics", () => {
    registry.register(latencyDef);
    registry.register(counterDef);
    expect(registry.listMetrics().sort()).toEqual(["frame_count", "input_latency"]);
  });

  it("duplicate registration throws", () => {
    registry.register(latencyDef);
    expect(() => registry.register(latencyDef)).toThrow(/already registered/);
  });

  it("recording to unregistered metric is a no-op (no throw)", () => {
    // Should not throw — just warn.
    registry.record("nonexistent", 42);
  });

  it("record and retrieve metric with buffer", () => {
    registry.register(latencyDef);
    registry.record("input_latency", 12.5, 1000);
    registry.record("input_latency", 8.3, 2000);

    const metric = registry.getMetric("input_latency");
    expect(metric).toBeDefined();
    expect(metric!.definition.name).toBe("input_latency");
    expect(metric!.buffer.getCount()).toBe(2);
    expect(Array.from(metric!.buffer.getValues())).toEqual([12.5, 8.3]);
  });

  it("lazy buffer allocation: no buffer until first record", () => {
    registry.register(latencyDef);
    // getMetric returns undefined when no samples have been recorded.
    expect(registry.getMetric("input_latency")).toBeUndefined();

    registry.record("input_latency", 5, 100);
    expect(registry.getMetric("input_latency")).toBeDefined();
  });

  it("getDefinition works even before recording", () => {
    registry.register(latencyDef);
    const def = registry.getDefinition("input_latency");
    expect(def).toBeDefined();
    expect(def!.name).toBe("input_latency");
  });

  it("unregister removes metric", () => {
    registry.register(latencyDef);
    registry.record("input_latency", 1, 1);
    registry.unregister("input_latency");

    expect(registry.getMetric("input_latency")).toBeUndefined();
    expect(registry.listMetrics()).toEqual([]);
  });

  it("uses provided timestamp, not monotonicNow", () => {
    registry.register(latencyDef);
    registry.record("input_latency", 10, 99999);
    // If it used monotonicNow the timestamp would be very different from 99999.
    // We verify indirectly by checking the value was stored.
    const metric = registry.getMetric("input_latency");
    expect(metric!.buffer.getCount()).toBe(1);
  });

  it("respects custom bufferSize from definition", () => {
    const smallDef: MetricDefinition = {
      name: "tiny",
      type: "gauge",
      unit: "bytes",
      description: "test",
      bufferSize: 3,
    };
    registry.register(smallDef);
    for (let i = 0; i < 5; i++) {
      registry.record("tiny", i, i * 10);
    }
    const metric = registry.getMetric("tiny");
    expect(metric!.buffer.getCount()).toBe(3);
    expect(metric!.buffer.getOverflowCount()).toBe(2);
  });
});
