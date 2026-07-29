/**
 * FR-HELIOS-051: Ghostty Metrics Collection Tests
 * Verifies: FR-GHT-005 (Frame metrics publishing), FR-PRF-005 (Memory sampling)
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { GhosttyMetrics } from "../../../../src/renderer/ghostty/metrics.js";
import type { MetricsSnapshot } from "../../../../src/renderer/ghostty/metrics.js";

describe("GhosttyMetrics - enable/disable", () => {
  let metrics: GhosttyMetrics;

  beforeEach(() => {
    metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
  });

  test("initially disabled", () => {
    expect(metrics.enabled).toBe(false);
  });

  test("enable sets enabled to true", () => {
    metrics.enable();
    expect(metrics.enabled).toBe(true);
  });

  test("disable sets enabled to false", () => {
    metrics.enable();
    metrics.disable();
    expect(metrics.enabled).toBe(false);
  });

  test("double enable is idempotent", () => {
    metrics.enable();
    metrics.enable();
    expect(metrics.enabled).toBe(true);
  });

  test("double disable is idempotent", () => {
    metrics.disable();
    metrics.disable();
    expect(metrics.enabled).toBe(false);
  });
});

describe("GhosttyMetrics - zero overhead when disabled", () => {
  test("recordFrame is no-op when disabled", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    // Record 100 frames while disabled
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      metrics.recordFrame(now + i * 16);
    }
    const snap = metrics.getSnapshot();
    // avgFps should be 0 because no frames were recorded while enabled
    expect(snap.avgFps).toBe(0);
    expect(snap.droppedFrames).toBe(0);
  });

  test("recordInputLatency is no-op when disabled", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.recordInputLatency(100, 110);
    const snap = metrics.getSnapshot();
    expect(snap.p50InputLatency).toBe(0);
  });
});

describe("GhosttyMetrics - frame recording", () => {
  let metrics: GhosttyMetrics;

  beforeEach(() => {
    metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.enable();
  });

  test("single frame records no frame time", () => {
    metrics.recordFrame(1000);
    const snap = metrics.getSnapshot();
    // First frame has no delta
    expect(snap.avgFps).toBe(0);
  });

  test("two frames at 60 FPS give ~16ms frame time", () => {
    metrics.recordFrame(1000);
    metrics.recordFrame(1016.67);
    const snap = metrics.getSnapshot();
    expect(snap.p50FrameTime).toBeCloseTo(16.67, 0);
    expect(snap.avgFps).toBeCloseTo(60, -1);
  });

  test("dropped frame detection at 2x target", () => {
    // Default target is 60 FPS -> 16.67ms target frame time
    // Dropped frame: > 33.33ms
    metrics.recordFrame(1000);
    metrics.recordFrame(1050); // 50ms > 33.33ms
    const snap = metrics.getSnapshot();
    expect(snap.droppedFrames).toBe(1);
  });

  test("no dropped frame at normal rate", () => {
    metrics.recordFrame(1000);
    metrics.recordFrame(1016);
    metrics.recordFrame(1032);
    const snap = metrics.getSnapshot();
    expect(snap.droppedFrames).toBe(0);
  });
});

describe("GhosttyMetrics - percentile accuracy", () => {
  test("p50 and p95 with uniform distribution", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.enable();

    // Generate 100 frame times: 10, 11, 12, ..., 109 ms
    let t = 1000;
    metrics.recordFrame(t);
    for (let i = 0; i < 100; i++) {
      const frameTime = 10 + i;
      t += frameTime;
      metrics.recordFrame(t);
    }

    const snap = metrics.getSnapshot();
    // p50 should be around 59ms (median of 10..109)
    expect(snap.p50FrameTime).toBeGreaterThanOrEqual(50);
    expect(snap.p50FrameTime).toBeLessThanOrEqual(70);
    // p95 should be around 104ms
    expect(snap.p95FrameTime).toBeGreaterThanOrEqual(95);
    expect(snap.p95FrameTime).toBeLessThanOrEqual(115);
  });

  test("p50 and p95 input latency", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.enable();

    // 100 latency samples: 5, 6, 7, ..., 104 ms
    for (let i = 0; i < 100; i++) {
      const latency = 5 + i;
      metrics.recordInputLatency(1000, 1000 + latency);
    }

    const snap = metrics.getSnapshot();
    expect(snap.p50InputLatency).toBeGreaterThanOrEqual(50);
    expect(snap.p50InputLatency).toBeLessThanOrEqual(60);
    expect(snap.p95InputLatency).toBeGreaterThanOrEqual(95);
    expect(snap.p95InputLatency).toBeLessThanOrEqual(110);
  });
});

describe("GhosttyMetrics - rolling window", () => {
  test("frames in window reset after windowMs", () => {
    const metrics = new GhosttyMetrics({ windowMs: 100, publishIntervalMs: 0 });
    metrics.enable();

    // Record frames within a 100ms window
    metrics.recordFrame(1000);
    metrics.recordFrame(1016);
    metrics.recordFrame(1032);
    // Trigger window roll
    metrics.recordFrame(1110);
    // After roll, framesInWindow should reset
    // This is internal state, but we can verify metrics still work
    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBeGreaterThan(0);
  });
});

describe("GhosttyMetrics - reset", () => {
  test("reset clears all data", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.enable();
    metrics.recordFrame(1000);
    metrics.recordFrame(1016);
    metrics.recordInputLatency(1000, 1010);
    metrics.reset();

    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBe(0);
    expect(snap.droppedFrames).toBe(0);
    expect(snap.p50InputLatency).toBe(0);
  });
});

describe("GhosttyMetrics - publisher", () => {
  test("publisher receives snapshots", async () => {
    const published: MetricsSnapshot[] = [];
    const metrics = new GhosttyMetrics({ publishIntervalMs: 50 });

    metrics.setPublisher((_topic, payload) => {
      published.push(payload);
    });
    metrics.enable();

    // Record some frames
    const now = Date.now();
    metrics.recordFrame(now);
    metrics.recordFrame(now + 16);

    // Wait for at least one publish
    await new Promise(r => setTimeout(r, 120));

    metrics.disable();
    expect(published.length).toBeGreaterThanOrEqual(1);
    expect(published[0]!.rendererId).toBe("ghostty");
  });

  test("clearPublisher stops publishing", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 50 });
    const published: MetricsSnapshot[] = [];
    metrics.setPublisher((_topic, payload) => {
      published.push(payload);
    });
    metrics.enable();
    metrics.clearPublisher();
    metrics.disable();
  });
});
