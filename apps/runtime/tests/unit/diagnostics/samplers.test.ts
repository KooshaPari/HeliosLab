/**
 * FR-HELIOS-069: Memory and Frame Timing Sampler Tests
 * Verifies: FR-PRF-005 (Memory usage sampling), FR-PRF-006 (Frame timing sampling)
 * Traces to: FR-DIAG-006 (circular sample buffers with overflow handling)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MetricsRegistry } from "../../../src/diagnostics/metrics.js";
import { MemorySampler, FrameTimingSampler } from "../../../src/diagnostics/samplers.js";

describe("MemorySampler", () => {
  let registry: MetricsRegistry;
  let sampler: MemorySampler;

  beforeEach(() => {
    registry = new MetricsRegistry();
    sampler = new MemorySampler(registry, 100);
  });

  afterEach(() => {
    sampler.stop();
  });

  // FR-005
  it("registers memory metric on construction", () => {
    const def = registry.getDefinition("memory");
    expect(def).toBeDefined();
    expect(def!.unit).toBe("MB");
  });

  // FR-005
  it("records samples at configured interval", async () => {
    sampler.start();
    await new Promise(r => setTimeout(r, 350));
    sampler.stop();
    const entry = registry.getMetric("memory");
    expect(entry).toBeDefined();
    expect(entry!.buffer.getCount()).toBeGreaterThanOrEqual(2);
  });

  // FR-005: Values in MB
  it("records values in MB (not bytes)", async () => {
    sampler.start();
    await new Promise(r => setTimeout(r, 150));
    sampler.stop();
    const entry = registry.getMetric("memory");
    expect(entry).toBeDefined();
    const values = entry!.buffer.getValues();
    // Heap should be at least a few MB but less than 10,000 MB
    expect(values[0]!).toBeGreaterThan(0.1);
    expect(values[0]!).toBeLessThan(10000);
  });

  // FR-005: Multiple start calls don't duplicate
  it("does not create duplicate intervals on multiple start calls", async () => {
    sampler.start();
    sampler.start();
    sampler.start();
    await new Promise(r => setTimeout(r, 250));
    sampler.stop();
    const entry = registry.getMetric("memory");
    // If duplicated, we'd have 3x the samples. With 100ms interval over 250ms, expect ~2-3.
    expect(entry!.buffer.getCount()).toBeLessThan(6);
  });

  // FR-005: stop halts cleanly
  it("stops sampling cleanly", async () => {
    sampler.start();
    await new Promise(r => setTimeout(r, 150));
    sampler.stop();
    const countAfterStop = registry.getMetric("memory")!.buffer.getCount();
    await new Promise(r => setTimeout(r, 200));
    const countLater = registry.getMetric("memory")!.buffer.getCount();
    expect(countLater).toBe(countAfterStop);
  });
});

describe("FrameTimingSampler", () => {
  let registry: MetricsRegistry;
  let sampler: FrameTimingSampler;

  beforeEach(() => {
    registry = new MetricsRegistry();
    sampler = new FrameTimingSampler(registry);
  });

  afterEach(() => {
    sampler.stop();
  });

  // FR-006
  it("registers fps metric on construction", () => {
    const def = registry.getDefinition("fps");
    expect(def).toBeDefined();
    expect(def!.unit).toBe("fps");
  });

  // FR-006: 60 frames in 1 second = FPS 60
  it("records FPS=60 for 60 frames in 1 second", () => {
    sampler.start();
    const baseTime = 1000;
    // First frame starts the window
    for (let i = 0; i < 60; i++) {
      sampler.recordFrame(baseTime + (i * 1000) / 60);
    }
    // Trigger window boundary
    sampler.recordFrame(baseTime + 1001);
    sampler.stop();

    const entry = registry.getMetric("fps");
    expect(entry).toBeDefined();
    const values = entry!.buffer.getValues();
    expect(values[0]!).toBe(60);
  });

  // FR-006: 30 frames in 1 second = FPS 30 (low FPS warning)
  it("records FPS=30 for 30 frames in 1 second", () => {
    sampler.start();
    const baseTime = 1000;
    for (let i = 0; i < 30; i++) {
      sampler.recordFrame(baseTime + (i * 1000) / 30);
    }
    sampler.recordFrame(baseTime + 1001);
    sampler.stop();

    const entry = registry.getMetric("fps");
    expect(entry).toBeDefined();
    const values = entry!.buffer.getValues();
    expect(values[0]!).toBe(30);
  });

  // FR-006: Multiple windows produce independent values
  it("produces independent FPS values for multiple windows", () => {
    sampler.start();
    let t = 1000;

    // Window 1: 60 fps
    for (let i = 0; i < 60; i++) {
      sampler.recordFrame(t);
      t += 1000 / 60;
    }

    // Window 2: 30 fps
    t = 2001;
    sampler.recordFrame(t); // triggers flush of window 1
    for (let i = 1; i < 30; i++) {
      sampler.recordFrame(t + (i * 1000) / 30);
    }
    sampler.recordFrame(t + 1001); // triggers flush of window 2
    sampler.stop();

    const entry = registry.getMetric("fps");
    expect(entry).toBeDefined();
    expect(entry!.buffer.getCount()).toBe(2);
  });

  // FR-006: does not record when not running
  it("ignores frames when not started", () => {
    sampler.recordFrame(1000);
    sampler.recordFrame(2000);
    const entry = registry.getMetric("fps");
    expect(entry).toBeUndefined();
  });
});
