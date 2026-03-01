import { describe, it, expect, afterEach, vi } from "vitest";
import { RuntimeMetrics } from "./metrics";

describe(RuntimeMetrics, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("record()", () => {
    it("adds a sample with correct properties", () => {
      const metrics = new RuntimeMetrics();
      const now = new Date();
      vi.setSystemTime(now);

      const sample = metrics.record("lane_create_latency_ms", 42, "ms");

      expect(sample.metric).toBe("lane_create_latency_ms");
      expect(sample.value).toBe(42);
      expect(sample.unit).toBe("ms");
      expect(sample.ts).toBe(now.toISOString());
      expect(sample.tags).toBeUndefined();
    });

    it("adds multiple samples", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("lane_create_latency_ms", 20, "ms");
      metrics.record("session_restore_latency_ms", 100, "ms");

      const report = metrics.getReport();
      expect(report.samples).toHaveLength(3);
    });

    it("includes tags when provided", () => {
      const metrics = new RuntimeMetrics();
      const tags = { session_id: "sess-123", lane_id: "lane-456" };

      const sample = metrics.record("lane_create_latency_ms", 50, "ms", tags);

      expect(sample.tags).toEqual(tags);
    });

    it("returns the created sample", () => {
      const metrics = new RuntimeMetrics();

      const sample = metrics.record("terminal_output_backlog_depth", 5, "count");

      expect(sample).toBeDefined();
      expect(sample.value).toBe(5);
    });
  });

  describe("startTimer() and endTimer()", () => {
    it("measures elapsed time between start and end", () => {
      const metrics = new RuntimeMetrics();
      const startTime = 1000;
      const endTime = 1500;

      vi.setSystemTime(startTime);
      metrics.startTimer("lane_create_latency_ms", "timer-1");

      vi.setSystemTime(endTime);
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-1");

      expect(sample).not.toBeNull();
      expect(sample!.value).toBe(500);
      expect(sample!.unit).toBe("ms");
    });

    it("handles timer with zero elapsed time", () => {
      const metrics = new RuntimeMetrics();
      const time = 1000;

      vi.setSystemTime(time);
      metrics.startTimer("lane_create_latency_ms", "timer-1");
      metrics.endTimer("lane_create_latency_ms", "timer-1");

      const report = metrics.getReport();
      expect(report.samples[0].value).toBe(0);
    });

    it("ignores endTimer without corresponding startTimer", () => {
      const metrics = new RuntimeMetrics();

      const sample = metrics.endTimer("lane_create_latency_ms", "non-existent");

      expect(sample).toBeNull();
    });

    it("returns null when timer key not found", () => {
      const metrics = new RuntimeMetrics();

      metrics.startTimer("lane_create_latency_ms", "timer-1");
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-2");

      expect(sample).toBeNull();
    });

    it("preserves tags from startTimer", () => {
      const metrics = new RuntimeMetrics();
      const startTags = { session_id: "sess-123" };

      vi.setSystemTime(1000);
      metrics.startTimer("lane_create_latency_ms", "timer-1", startTags);

      vi.setSystemTime(1100);
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-1");

      expect(sample!.tags).toEqual(startTags);
    });

    it("merges tags from startTimer and endTimer", () => {
      const metrics = new RuntimeMetrics();
      const startTags = { session_id: "sess-123" };
      const endTags = { result: "success" };

      vi.setSystemTime(1000);
      metrics.startTimer("lane_create_latency_ms", "timer-1", startTags);

      vi.setSystemTime(1100);
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-1", endTags);

      expect(sample!.tags).toEqual({ ...startTags, ...endTags });
    });

    it("allows multiple concurrent timers with different keys", () => {
      const metrics = new RuntimeMetrics();

      vi.setSystemTime(1000);
      metrics.startTimer("lane_create_latency_ms", "timer-1");
      metrics.startTimer("lane_create_latency_ms", "timer-2");

      vi.setSystemTime(1100);
      const sample1 = metrics.endTimer("lane_create_latency_ms", "timer-1");

      vi.setSystemTime(1200);
      const sample2 = metrics.endTimer("lane_create_latency_ms", "timer-2");

      expect(sample1!.value).toBe(100);
      expect(sample2!.value).toBe(200);
    });

    it("allows reusing the same timer key after completion", () => {
      const metrics = new RuntimeMetrics();

      vi.setSystemTime(1000);
      metrics.startTimer("lane_create_latency_ms", "timer-1");
      vi.setSystemTime(1100);
      metrics.endTimer("lane_create_latency_ms", "timer-1");

      vi.setSystemTime(2000);
      metrics.startTimer("lane_create_latency_ms", "timer-1");
      vi.setSystemTime(2200);
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-1");

      expect(sample!.value).toBe(200);
    });

    it("preserves elapsed time with negative offset (ensures non-negative)", () => {
      const metrics = new RuntimeMetrics();

      vi.setSystemTime(1000);
      metrics.startTimer("lane_create_latency_ms", "timer-1");

      vi.setSystemTime(800); // Moving time backward (shouldn't happen, but code handles it)
      const sample = metrics.endTimer("lane_create_latency_ms", "timer-1");

      expect(sample!.value).toBe(0); // Math.max(0, negative) = 0
    });
  });

  describe("getReport()", () => {
    it("returns empty report for no samples", () => {
      const metrics = new RuntimeMetrics();

      const report = metrics.getReport();

      expect(report.samples).toEqual([]);
      expect(report.summaries).toEqual([]);
    });

    it("returns samples in the report", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("session_restore_latency_ms", 100, "ms");

      const report = metrics.getReport();

      expect(report.samples).toHaveLength(2);
      expect(report.samples[0].metric).toBe("lane_create_latency_ms");
      expect(report.samples[1].metric).toBe("session_restore_latency_ms");
    });

    it("creates summaries from samples", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("lane_create_latency_ms", 20, "ms");

      const report = metrics.getReport();

      expect(report.summaries).toHaveLength(1);
      expect(report.summaries[0].metric).toBe("lane_create_latency_ms");
    });

    it("calculates correct summary statistics for single sample", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 42, "ms");

      const report = metrics.getReport();
      const summary = report.summaries[0];

      expect(summary.metric).toBe("lane_create_latency_ms");
      expect(summary.unit).toBe("ms");
      expect(summary.count).toBe(1);
      expect(summary.min).toBe(42);
      expect(summary.max).toBe(42);
      expect(summary.p50).toBe(42);
      expect(summary.p95).toBe(42);
      expect(summary.latest).toBe(42);
    });

    it("calculates correct summary statistics for multiple samples", () => {
      const metrics = new RuntimeMetrics();

      // Values: 10, 20, 30, 40, 50
      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("lane_create_latency_ms", 20, "ms");
      metrics.record("lane_create_latency_ms", 30, "ms");
      metrics.record("lane_create_latency_ms", 40, "ms");
      metrics.record("lane_create_latency_ms", 50, "ms");

      const report = metrics.getReport();
      const summary = report.summaries[0];

      expect(summary.count).toBe(5);
      expect(summary.min).toBe(10);
      expect(summary.max).toBe(50);
      expect(summary.latest).toBe(50); // Last recorded value
      // P50 = percentile(sorted, 0.5) -> index = ceil(5 * 0.5) - 1 = 2 -> values[2] = 30
      expect(summary.p50).toBe(30);
      // P95 = percentile(sorted, 0.95) -> index = ceil(5 * 0.95) - 1 = 4 -> values[4] = 50
      expect(summary.p95).toBe(50);
    });

    it("includes correct metric name in summaries", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("session_restore_latency_ms", 100, "ms");
      metrics.record("terminal_output_backlog_depth", 5, "count");

      const report = metrics.getReport();

      const names = report.summaries.map((s) => s.metric);
      expect(names).toContain("lane_create_latency_ms");
      expect(names).toContain("session_restore_latency_ms");
      expect(names).toContain("terminal_output_backlog_depth");
    });

    it("includes correct unit in summaries", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("terminal_output_backlog_depth", 5, "count");

      const report = metrics.getReport();

      const msSummary = report.summaries.find((s) => s.metric === "lane_create_latency_ms");
      const countSummary = report.summaries.find(
        (s) => s.metric === "terminal_output_backlog_depth",
      );

      expect(msSummary!.unit).toBe("ms");
      expect(countSummary!.unit).toBe("count");
    });

    it("aggregates multiple records for the same metric", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 5, "ms");
      metrics.record("lane_create_latency_ms", 15, "ms");
      metrics.record("lane_create_latency_ms", 25, "ms");

      const report = metrics.getReport();

      expect(report.summaries).toHaveLength(1);
      expect(report.summaries[0].count).toBe(3);
      expect(report.summaries[0].min).toBe(5);
      expect(report.summaries[0].max).toBe(25);
    });

    it("handles multiple different metrics correctly", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("lane_create_latency_ms", 20, "ms");
      metrics.record("session_restore_latency_ms", 100, "ms");
      metrics.record("session_restore_latency_ms", 200, "ms");

      const report = metrics.getReport();

      expect(report.summaries).toHaveLength(2);

      const lane = report.summaries.find((s) => s.metric === "lane_create_latency_ms");
      const session = report.summaries.find((s) => s.metric === "session_restore_latency_ms");

      expect(lane!.count).toBe(2);
      expect(lane!.min).toBe(10);
      expect(lane!.max).toBe(20);

      expect(session!.count).toBe(2);
      expect(session!.min).toBe(100);
      expect(session!.max).toBe(200);
    });

    it("returns latest value as the last recorded sample value", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("lane_create_latency_ms", 50, "ms");
      metrics.record("lane_create_latency_ms", 30, "ms");

      const report = metrics.getReport();
      const summary = report.summaries[0];

      expect(summary.latest).toBe(30); // Last recorded value, not highest
    });

    it("sorts summaries by metric name", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("terminal_output_backlog_depth", 5, "count");
      metrics.record("lane_create_latency_ms", 10, "ms");
      metrics.record("session_restore_latency_ms", 100, "ms");

      const report = metrics.getReport();

      expect(report.summaries[0].metric).toBe("lane_create_latency_ms");
      expect(report.summaries[1].metric).toBe("session_restore_latency_ms");
      expect(report.summaries[2].metric).toBe("terminal_output_backlog_depth");
    });

    it("creates independent copy of samples in report", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");
      const report1 = metrics.getReport();

      metrics.record("lane_create_latency_ms", 20, "ms");
      const report2 = metrics.getReport();

      expect(report1.samples).toHaveLength(1);
      expect(report2.samples).toHaveLength(2);
    });
  });

  describe("integration scenarios", () => {
    it("combines records and timers in single report", () => {
      const metrics = new RuntimeMetrics();

      metrics.record("lane_create_latency_ms", 10, "ms");

      vi.setSystemTime(1000);
      metrics.startTimer("session_restore_latency_ms", "restore-1");
      vi.setSystemTime(1150);
      metrics.endTimer("session_restore_latency_ms", "restore-1");

      metrics.record("terminal_output_backlog_depth", 42, "count");

      const report = metrics.getReport();

      expect(report.samples).toHaveLength(3);
      expect(report.summaries).toHaveLength(3);
    });

    it("handles mixed tags from records and timers", () => {
      const metrics = new RuntimeMetrics();

      const recordSample = metrics.record("lane_create_latency_ms", 10, "ms", { source: "record" });

      vi.setSystemTime(1000);
      metrics.startTimer("session_restore_latency_ms", "restore-1", { session_id: "sess-1" });
      vi.setSystemTime(1100);
      const timerSample = metrics.endTimer("session_restore_latency_ms", "restore-1", {
        result: "success",
      });

      expect(recordSample.tags).toEqual({ source: "record" });
      expect(timerSample!.tags).toEqual({ session_id: "sess-1", result: "success" });
    });

    it("accumulates metrics over time and produces correct aggregates", () => {
      const metrics = new RuntimeMetrics();

      // First batch
      metrics.record("lane_create_latency_ms", 100, "ms");
      metrics.record("lane_create_latency_ms", 110, "ms");

      // Timer batch
      vi.setSystemTime(2000);
      metrics.startTimer("lane_create_latency_ms", "timer-1");
      vi.setSystemTime(2120);
      metrics.endTimer("lane_create_latency_ms", "timer-1");

      // Second record batch
      metrics.record("lane_create_latency_ms", 105, "ms");

      const report = metrics.getReport();
      const summary = report.summaries[0];

      expect(summary.count).toBe(4);
      expect(summary.min).toBe(100);
      expect(summary.max).toBe(120);
      expect(summary.latest).toBe(105);
    });
  });
});
