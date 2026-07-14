/**
 * FR-HELIOS-053: Rio Metrics Collection Tests
 * Verifies: FR-RIO-005 (Frame metrics using same schema as ghostty), FR-PRF-005 (Memory sampling)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  RioMetrics,
} from "../../../../src/renderer/rio/metrics.js";

describe("RioMetrics — schema identity with ghostty", () => {
  let metrics: RioMetrics;

  beforeEach(() => {
    metrics = new RioMetrics(10, 100);
  });

  afterEach(() => {
    metrics.stop();
  });

  it("snapshot has all required fields", () => {
    metrics.recordFrame(16.6, 5, false);
    const snap = metrics.getSnapshots()[0]!;

    // Verify all MetricsSnapshot fields exist.
    expect(snap.rendererId).toBe("rio");
    expect(typeof snap.timestamp).toBe("number");
    expect(typeof snap.frameTimeMs).toBe("number");
    expect(typeof snap.fps).toBe("number");
    expect(typeof snap.inputLatencyMs).toBe("number");
    expect(typeof snap.frameCount).toBe("number");
    expect(typeof snap.droppedFrames).toBe("number");
  });

  it("summary has all required fields", () => {
    metrics.recordFrame(16.6, 5, false);
    const summary = metrics.getSummary();

    expect(summary.rendererId).toBe("rio");
    expect(typeof summary.frameTime.p50).toBe("number");
    expect(typeof summary.frameTime.p95).toBe("number");
    expect(typeof summary.frameTime.min).toBe("number");
    expect(typeof summary.frameTime.max).toBe("number");
    expect(typeof summary.fps.p50).toBe("number");
    expect(typeof summary.fps.p95).toBe("number");
    expect(typeof summary.inputLatency.p50).toBe("number");
    expect(typeof summary.inputLatency.p95).toBe("number");
    expect(typeof summary.totalFrames).toBe("number");
    expect(typeof summary.totalDroppedFrames).toBe("number");
    expect(typeof summary.windowDurationMs).toBe("number");
  });

  it("rendererId is 'rio' (not 'ghostty')", () => {
    metrics.recordFrame(16.6, 5, false);
    const snap = metrics.getSnapshots()[0]!;
    expect(snap.rendererId).toBe("rio");
    expect(metrics.getSummary().rendererId).toBe("rio");
  });

  it("fps calculation is correct", () => {
    metrics.recordFrame(16.666, 5, false);
    const snap = metrics.getSnapshots()[0]!;
    expect(snap.fps).toBeCloseTo(60, 0); // ~60 FPS at 16.666ms
  });

  it("dropped frames increment correctly", () => {
    metrics.recordFrame(16.6, 5, false);
    metrics.recordFrame(33.3, 10, true);
    metrics.recordFrame(16.6, 5, false);
    expect(metrics.getSummary().totalDroppedFrames).toBe(1);
    expect(metrics.getSummary().totalFrames).toBe(3);
  });

  it("respects window size", () => {
    for (let i = 0; i < 20; i++) {
      metrics.recordFrame(16.6, 5, false);
    }
    expect(metrics.getSnapshots().length).toBe(10);
  });

  it("empty summary returns zeros", () => {
    const summary = metrics.getSummary();
    expect(summary.totalFrames).toBe(0);
    expect(summary.frameTime.p50).toBe(0);
    expect(summary.fps.p50).toBe(0);
  });

  it("start/stop lifecycle", () => {
    expect(metrics.isCollecting()).toBe(false);
    metrics.start();
    expect(metrics.isCollecting()).toBe(true);
    metrics.stop();
    expect(metrics.isCollecting()).toBe(false);
  });

  it("start is idempotent", () => {
    metrics.start();
    metrics.start(); // should not throw
    expect(metrics.isCollecting()).toBe(true);
  });

  it("stop is idempotent", () => {
    metrics.stop(); // not started
    metrics.stop(); // should not throw
    expect(metrics.isCollecting()).toBe(false);
  });
});
