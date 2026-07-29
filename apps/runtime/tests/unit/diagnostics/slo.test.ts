// FR-003: Unit tests for SLO definitions and checks.
// Traces to: FR-DIAG-005 (SLO violation events), FR-DIAG-009 (SLOMonitor class)

import { describe, it, expect } from "bun:test";
import { SLO_DEFINITIONS, getSLOsForMetric, checkSLO } from "../../../src/diagnostics/slo.js";
import type { PercentileBucket, SLODefinition } from "../../../src/diagnostics/types.js";

function makeBucket(overrides: Partial<PercentileBucket> = {}): PercentileBucket {
  return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, count: 100, ...overrides };
}

describe("SLO_DEFINITIONS", () => {
  // FR-003
  it("contains all constitution SLOs", () => {
    expect(SLO_DEFINITIONS.length).toBe(7);
  });

  it("is frozen / immutable", () => {
    expect(Object.isFrozen(SLO_DEFINITIONS)).toBe(true);
  });
});

describe("getSLOsForMetric", () => {
  // FR-003
  it("returns SLOs for input-to-echo", () => {
    const slos = getSLOsForMetric("input-to-echo");
    expect(slos.length).toBe(2);
  });

  it("returns empty array for unknown metric", () => {
    expect(getSLOsForMetric("nonexistent")).toEqual([]);
  });

  it("returns single SLO for fps", () => {
    const slos = getSLOsForMetric("fps");
    expect(slos.length).toBe(1);
    expect(slos[0]!.threshold).toBe(60);
  });
});

describe("checkSLO", () => {
  // FR-003: Latency pass
  it("passes when latency is under threshold", () => {
    const slo: SLODefinition = {
      metric: "input-to-echo",
      percentile: "p50",
      threshold: 30,
      unit: "ms",
    };
    const result = checkSLO(slo, makeBucket({ p50: 25 }));
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(25);
  });

  // FR-003: Latency fail
  it("fails when latency exceeds threshold", () => {
    const slo: SLODefinition = {
      metric: "input-to-echo",
      percentile: "p50",
      threshold: 30,
      unit: "ms",
    };
    const result = checkSLO(slo, makeBucket({ p50: 35 }));
    expect(result.passed).toBe(false);
  });

  // FR-003: FPS inverse check
  it("passes when FPS is at or above threshold", () => {
    const slo: SLODefinition = {
      metric: "fps",
      percentile: "p50",
      threshold: 60,
      unit: "fps",
    };
    const result = checkSLO(slo, makeBucket({ p50: 60 }));
    expect(result.passed).toBe(true);
  });

  it("fails when FPS is below threshold", () => {
    const slo: SLODefinition = {
      metric: "fps",
      percentile: "p50",
      threshold: 60,
      unit: "fps",
    };
    const result = checkSLO(slo, makeBucket({ p50: 45 }));
    expect(result.passed).toBe(false);
  });

  // FR-003: Zero-count bucket passes
  it("passes with zero-count bucket (no data = no violation)", () => {
    const slo: SLODefinition = {
      metric: "input-to-echo",
      percentile: "p50",
      threshold: 30,
      unit: "ms",
    };
    const result = checkSLO(slo, makeBucket({ count: 0 }));
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(0);
  });

  // FR-003: Memory SLO
  it("passes memory SLO when under threshold", () => {
    const slo: SLODefinition = {
      metric: "memory",
      percentile: "p95",
      threshold: 500,
      unit: "MB",
    };
    const result = checkSLO(slo, makeBucket({ p95: 300 }));
    expect(result.passed).toBe(true);
  });

  it("fails memory SLO when over threshold", () => {
    const slo: SLODefinition = {
      metric: "memory",
      percentile: "p95",
      threshold: 500,
      unit: "MB",
    };
    const result = checkSLO(slo, makeBucket({ p95: 600 }));
    expect(result.passed).toBe(false);
  });
});
