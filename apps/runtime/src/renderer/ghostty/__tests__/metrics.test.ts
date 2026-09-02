/**
 * Unit tests for GhosttyMetrics (T008, T009).
 */

import { GhosttyMetrics } from "../metrics.js";
import type { MetricsSnapshot } from "../metrics.js";

describe("GhosttyMetrics", () => {
  let metrics: GhosttyMetrics;

  beforeEach(() => {
    metrics = new GhosttyMetrics();
  });

  afterEach(() => {
    metrics.disable();
  });

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------

  test("starts disabled", () => {
    expect(metrics.enabled).toBe(false);
  });

  test("enable / disable toggles state", () => {
    metrics.enable();
    expect(metrics.enabled).toBe(true);
    metrics.disable();
    expect(metrics.enabled).toBe(false);
  });

  test("enable is idempotent", () => {
    metrics.enable();
    metrics.enable();
    expect(metrics.enabled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Snapshot with no data
  // -----------------------------------------------------------------------

  test("snapshot with no frames returns zeros", () => {
    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBe(0);
    expect(snap.p50FrameTime).toBe(0);
    expect(snap.p95FrameTime).toBe(0);
    expect(snap.droppedFrames).toBe(0);
    expect(snap.p50InputLatency).toBe(0);
    expect(snap.p95InputLatency).toBe(0);
    expect(snap.rendererId).toBe("ghostty");
  });

  // -----------------------------------------------------------------------
  // Frame recording
  // -----------------------------------------------------------------------

  test("records frames and calculates FPS", () => {
    metrics.enable();

    // Simulate 10 frames at ~60 FPS (16.67ms apart)
    const start = 1_000_000;
    for (let i = 0; i < 10; i++) {
      metrics.recordFrame(start + i * 16.67);
    }

    const snap = metrics.getSnapshot();
    // Average frame time should be ~16.67ms -> ~60 FPS
    expect(snap.avgFps).toBeGreaterThan(55);
    expect(snap.avgFps).toBeLessThan(65);
    expect(snap.p50FrameTime).toBeGreaterThan(15);
    expect(snap.p50FrameTime).toBeLessThan(18);
  });

  test("does not record frames when disabled", () => {
    // Do NOT enable
    metrics.recordFrame(1_000_000);
    metrics.recordFrame(1_000_017);

    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBe(0);
  });

  test("detects dropped frames (> 2x target frame time)", () => {
    metrics.enable();

    const start = 1_000_000;
    metrics.recordFrame(start);
    // Normal frame
    metrics.recordFrame(start + 16);
    // Dropped frame: 50ms gap (> 2 * 16.67ms)
    metrics.recordFrame(start + 66);

    const snap = metrics.getSnapshot();
    expect(snap.droppedFrames).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Input latency
  // -----------------------------------------------------------------------

  test("records and reports input latency", () => {
    metrics.enable();

    metrics.recordInputLatency(1_000, 1_025);
    metrics.recordInputLatency(2_000, 2_030);
    metrics.recordInputLatency(3_000, 3_020);

    const snap = metrics.getSnapshot();
    expect(snap.p50InputLatency).toBeGreaterThan(0);
    expect(snap.p95InputLatency).toBeGreaterThan(0);
  });

  test("does not record input latency when disabled", () => {
    metrics.recordInputLatency(1_000, 1_025);
    const snap = metrics.getSnapshot();
    expect(snap.p50InputLatency).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  test("reset clears all data", () => {
    metrics.enable();
    metrics.recordFrame(1_000_000);
    metrics.recordFrame(1_000_017);
    metrics.recordInputLatency(1_000, 1_025);
    metrics.reset();

    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBe(0);
    expect(snap.droppedFrames).toBe(0);
    expect(snap.p50InputLatency).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Metrics enabled mid-session
  // -----------------------------------------------------------------------

  test("enabling mid-session starts collecting from enable point", () => {
    // Record some frames while disabled -- should be ignored
    metrics.recordFrame(1_000_000);
    metrics.recordFrame(1_000_017);

    metrics.enable();

    // Now record frames
    metrics.recordFrame(2_000_000);
    metrics.recordFrame(2_000_017);

    const snap = metrics.getSnapshot();
    // Only 1 interval recorded (between the two enabled frames)
    expect(snap.p50FrameTime).toBeGreaterThan(15);
    expect(snap.p50FrameTime).toBeLessThan(20);
  });

  // -----------------------------------------------------------------------
  // High FPS handling
  // -----------------------------------------------------------------------

  test("handles very high FPS (> 120)", () => {
    metrics.enable();
    const start = 1_000_000;
    // ~120 FPS: 8.33ms per frame
    for (let i = 0; i < 20; i++) {
      metrics.recordFrame(start + i * 8.33);
    }

    const snap = metrics.getSnapshot();
    expect(snap.avgFps).toBeGreaterThan(115);
    expect(snap.avgFps).toBeLessThan(125);
  });

  // -----------------------------------------------------------------------
  // Publishing (T009)
  // -----------------------------------------------------------------------

  test("publishes metrics at configured interval", async () => {
    const published: MetricsSnapshot[] = [];
    const fastMetrics = new GhosttyMetrics({ publishIntervalMs: 50 });

    fastMetrics.setPublisher((_topic, payload) => {
      published.push(payload);
    });

    fastMetrics.enable();
    fastMetrics.recordFrame(Date.now());

    // Wait for at least one publish cycle
    await new Promise(resolve => setTimeout(resolve, 120));

    fastMetrics.disable();

    expect(published.length).toBeGreaterThanOrEqual(1);
    expect(published[0]?.rendererId).toBe("ghostty");
  });

  test("stops publishing when disabled", async () => {
    const published: MetricsSnapshot[] = [];
    const fastMetrics = new GhosttyMetrics({ publishIntervalMs: 30 });

    fastMetrics.setPublisher((_topic, payload) => {
      published.push(payload);
    });

    fastMetrics.enable();
    await new Promise(resolve => setTimeout(resolve, 80));
    fastMetrics.disable();

    const countAfterDisable = published.length;
    await new Promise(resolve => setTimeout(resolve, 80));

    // No new events after disable
    expect(published.length).toBe(countAfterDisable);
  });

  test("interval 0 disables periodic publishing", async () => {
    const published: MetricsSnapshot[] = [];
    const noPublish = new GhosttyMetrics({ publishIntervalMs: 0 });

    noPublish.setPublisher((_topic, payload) => {
      published.push(payload);
    });

    noPublish.enable();
    await new Promise(resolve => setTimeout(resolve, 100));
    noPublish.disable();

    expect(published.length).toBe(0);
  });

  test("clearPublisher stops publishing", async () => {
    const published: MetricsSnapshot[] = [];
    const fastMetrics = new GhosttyMetrics({ publishIntervalMs: 30 });

    fastMetrics.setPublisher((_topic, payload) => {
      published.push(payload);
    });

    fastMetrics.enable();
    await new Promise(resolve => setTimeout(resolve, 50));
    fastMetrics.clearPublisher();
    const count = published.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    fastMetrics.disable();

    expect(published.length).toBe(count);
  });
});
