/**
 * FR-HELIOS-033: Metrics Query API Tests
 * Verifies: FR-PRF-007 (Metrics query API), FR-DIAG-008 (MetricsQuery interface)
 * Traces to: FR-DIAG-008 (MetricsQuery interface with getMetric and listMetrics)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { MetricsRegistry } from "../../../src/diagnostics/metrics.js";
import { MetricsQuery } from "../../../src/diagnostics/query.js";

describe("MetricsQuery", () => {
  let registry: MetricsRegistry;
  let query: MetricsQuery;

  beforeEach(() => {
    registry = new MetricsRegistry();
    query = new MetricsQuery(registry);
  });

  // FR-007: getStats returns correct percentiles
  it("getStats returns correct percentiles for recorded data", () => {
    registry.register({
      name: "latency",
      type: "latency",
      unit: "ms",
      description: "test",
    });
    for (let i = 1; i <= 100; i++) {
      registry.record("latency", i);
    }
    const stats = query.getStats("latency");
    expect(stats).not.toBeNull();
    expect(stats!.p50).toBe(51);
    expect(stats!.count).toBe(100);
  });

  // FR-007: Unknown metric returns null
  it("getStats returns null for unknown metric", () => {
    expect(query.getStats("nonexistent")).toBeNull();
  });

  // FR-007: Registered but never recorded returns null (no buffer)
  it("getStats returns null for metric with no samples", () => {
    registry.register({
      name: "empty",
      type: "gauge",
      unit: "x",
      description: "test",
    });
    expect(query.getStats("empty")).toBeNull();
  });

  // FR-007: getAllStats
  it("getAllStats includes all registered metrics with samples", () => {
    registry.register({
      name: "a",
      type: "gauge",
      unit: "x",
      description: "a",
    });
    registry.register({
      name: "b",
      type: "gauge",
      unit: "x",
      description: "b",
    });
    registry.record("a", 10);
    registry.record("b", 20);

    const all = query.getAllStats();
    expect(Object.keys(all)).toContain("a");
    expect(Object.keys(all)).toContain("b");
    expect(all["a"]!.count).toBe(1);
    expect(all["b"]!.count).toBe(1);
  });

  // FR-007: getAllStats excludes metrics without samples
  it("getAllStats excludes metrics without samples", () => {
    registry.register({
      name: "recorded",
      type: "gauge",
      unit: "x",
      description: "x",
    });
    registry.register({
      name: "empty",
      type: "gauge",
      unit: "x",
      description: "x",
    });
    registry.record("recorded", 5);

    const all = query.getAllStats();
    expect(Object.keys(all)).toContain("recorded");
    expect(Object.keys(all)).not.toContain("empty");
  });

  // FR-007: getRawSamples
  it("getRawSamples returns all samples when no limit", () => {
    registry.register({
      name: "m",
      type: "gauge",
      unit: "x",
      description: "x",
    });
    for (let i = 1; i <= 5; i++) registry.record("m", i);

    const samples = query.getRawSamples("m");
    expect(samples.length).toBe(5);
    expect(samples[0]!.value).toBe(1);
    expect(samples[4]!.value).toBe(5);
  });

  // FR-007: getRawSamples respects limit
  it("getRawSamples respects limit parameter", () => {
    registry.register({
      name: "m",
      type: "gauge",
      unit: "x",
      description: "x",
    });
    for (let i = 1; i <= 10; i++) registry.record("m", i);

    const samples = query.getRawSamples("m", 3);
    expect(samples.length).toBe(3);
    // Should return the most recent 3
    expect(samples[0]!.value).toBe(8);
    expect(samples[2]!.value).toBe(10);
  });

  // FR-007: getRawSamples for unknown metric
  it("getRawSamples returns empty for unknown metric", () => {
    expect(query.getRawSamples("unknown")).toEqual([]);
  });
});
