/**
 * Tests for the Rio renderer adapter (WP01).
 *
 * Covers: feature flag gate, adapter interface conformance, process lifecycle,
 * surface binding, capabilities, metrics, and input relay.
 */

import { RioBackend, FeatureFlagDisabledError } from "../rio/backend.js";

import { RioProcess } from "../rio/process.js";
import { RioSurface } from "../rio/surface.js";
import { RioCapabilities } from "../rio/capabilities.js";
import { RioMetrics } from "../rio/metrics.js";
import { RioInputRelay } from "../rio/input.js";
import type { RendererConfig, RenderSurface } from "../adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _DEFAULT_CONFIG: RendererConfig = {
  gpuAcceleration: false,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

const DEFAULT_SURFACE: RenderSurface = {
  windowId: "win-1",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

// ---------------------------------------------------------------------------
// T001 — Feature flag gate
// ---------------------------------------------------------------------------

describe("T001 — Feature flag gate", () => {
  it("returns false when flag is missing", () => {
    expect(isRioEnabled({})).toBe(false);
  });

  it("returns false when flag is explicitly false", () => {
    expect(isRioEnabled({ featureFlags: { rioRenderer: false } })).toBe(false);
  });

  it("returns true when flag is true", () => {
    expect(isRioEnabled({ featureFlags: { rioRenderer: true } })).toBe(true);
  });

  it("returns false when featureFlags exists but rioRenderer is missing", () => {
    expect(isRioEnabled({ featureFlags: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T002 — RioBackend adapter conformance
// ---------------------------------------------------------------------------

describe("T002 — RioBackend adapter conformance", () => {
  let backend: RioBackend;

  beforeEach(() => {
    backend = new RioBackend();
  });

  it("has id 'rio'", () => {
    expect(backend.id).toBe("rio");
  });

  it("has a version string", () => {
    expect(typeof backend.version).toBe("string");
    expect(backend.version.length).toBeGreaterThan(0);
  });

  it("starts in uninitialized state", () => {
    expect(backend.getState()).toBe("uninitialized");
  });

  it("implements all RendererAdapter methods", () => {
    expect(typeof backend.init).toBe("function");
    expect(typeof backend.start).toBe("function");
    expect(typeof backend.stop).toBe("function");
    expect(typeof backend.bindStream).toBe("function");
    expect(typeof backend.unbindStream).toBe("function");
    expect(typeof backend.handleInput).toBe("function");
    expect(typeof backend.resize).toBe("function");
    expect(typeof backend.queryCapabilities).toBe("function");
    expect(typeof backend.getState).toBe("function");
    expect(typeof backend.onCrash).toBe("function");
  });

  it("rejects operations when disabled", () => {
    backend.setDisabled();
    expect(() => backend.handleInput("pty-1", new Uint8Array([0x41]))).toThrow(
      FeatureFlagDisabledError
    );
  });

  it("stop is idempotent when already stopped", async () => {
    // stop on uninitialized should not throw
    await backend.stop();
    expect(backend.getState()).toBe("uninitialized");
  });
});

// ---------------------------------------------------------------------------
// T003 — RioProcess
// ---------------------------------------------------------------------------

describe("T003 — RioProcess", () => {
  it("starts as not running", () => {
    const proc = new RioProcess();
    expect(proc.isRunning()).toBe(false);
    expect(proc.getPid()).toBeUndefined();
  });

  it("returns undefined uptime before start", () => {
    const proc = new RioProcess();
    expect(proc.getUptime()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T004 — RioSurface
// ---------------------------------------------------------------------------

describe("T004 — RioSurface", () => {
  let surface: RioSurface;

  beforeEach(() => {
    surface = new RioSurface();
  });

  it("starts unbound", () => {
    expect(surface.isBound()).toBe(false);
    expect(surface.getSurface()).toBeUndefined();
  });

  it("binds and unbinds correctly", () => {
    surface.bind(DEFAULT_SURFACE, 1234);
    expect(surface.isBound()).toBe(true);
    expect(surface.getPid()).toBe(1234);
    expect(surface.getSurface()).toEqual(DEFAULT_SURFACE);

    surface.unbind();
    expect(surface.isBound()).toBe(false);
    expect(surface.getSurface()).toBeUndefined();
  });

  it("resize updates bounds", () => {
    surface.bind(DEFAULT_SURFACE, 1234);
    surface.resize({ x: 10, y: 10, width: 640, height: 480 });
    expect(surface.getSurface()?.bounds).toEqual({
      x: 10,
      y: 10,
      width: 640,
      height: 480,
    });
  });

  it("resize ignores zero-size bounds", () => {
    surface.bind(DEFAULT_SURFACE, 1234);
    surface.resize({ x: 0, y: 0, width: 0, height: 0 });
    // Original bounds preserved.
    expect(surface.getSurface()?.bounds).toEqual(DEFAULT_SURFACE.bounds);
  });
});

// ---------------------------------------------------------------------------
// T005 — RioCapabilities and RioMetrics
// ---------------------------------------------------------------------------

describe("T005 — RioCapabilities", () => {
  it("returns default capabilities before detection", () => {
    const caps = new RioCapabilities();
    const result = caps.get();
    expect(result.colorDepth).toBe(24);
    expect(result.ligatureSupport).toBe(false);
    expect(result.inputModes).toContain("raw");
    expect(caps.isDetected()).toBe(false);
  });

  it("updates capabilities after detection", () => {
    const caps = new RioCapabilities();
    caps.detect({
      gpuAcceleration: true,
      colorDepth: 16,
      maxDimensions: { cols: 300, rows: 100 },
    });
    const result = caps.get();
    expect(result.gpuAccelerated).toBe(true);
    expect(result.colorDepth).toBe(16);
    expect(result.maxDimensions.cols).toBe(300);
    expect(caps.isDetected()).toBe(true);
  });

  it("capability query returns a copy (not reference)", () => {
    const caps = new RioCapabilities();
    const a = caps.get();
    const b = caps.get();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("T005 — RioMetrics", () => {
  let metrics: RioMetrics;

  beforeEach(() => {
    metrics = new RioMetrics(10, 100);
  });

  afterEach(() => {
    metrics.stop();
  });

  it("starts not collecting", () => {
    expect(metrics.isCollecting()).toBe(false);
  });

  it("records frames and computes summary", () => {
    metrics.recordFrame(16.6, 5, false);
    metrics.recordFrame(17.0, 6, false);
    metrics.recordFrame(33.2, 10, true);

    const summary = metrics.getSummary();
    expect(summary.rendererId).toBe("rio");
    expect(summary.totalFrames).toBe(3);
    expect(summary.totalDroppedFrames).toBe(1);
    expect(summary.frameTime.min).toBeGreaterThan(0);
  });

  it("respects rolling window size", () => {
    for (let i = 0; i < 20; i++) {
      metrics.recordFrame(16.6, 5, false);
    }
    // Window size is 10 — only 10 snapshots should remain.
    expect(metrics.getSnapshots().length).toBe(10);
  });

  it("metrics schema includes rendererId 'rio'", () => {
    metrics.recordFrame(16.6, 5, false);
    const snap = metrics.getSnapshots()[0];
    expect(snap?.rendererId).toBe("rio");
    expect(snap?.frameTimeMs).toBe(16.6);
    expect(snap?.inputLatencyMs).toBe(5);
  });

  it("empty summary returns zeros", () => {
    const summary = metrics.getSummary();
    expect(summary.totalFrames).toBe(0);
    expect(summary.frameTime.p50).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T006 — RioInputRelay
// ---------------------------------------------------------------------------

describe("T006 — RioInputRelay", () => {
  let relay: RioInputRelay;

  beforeEach(() => {
    relay = new RioInputRelay();
  });

  it("relays input to sink when ptyId provided", () => {
    const written: Array<{ ptyId: string; data: Uint8Array }> = [];
    relay.setSink({
      writeInput(ptyId, data) {
        written.push({ ptyId, data });
      },
    });

    relay.relay("pty-1", new Uint8Array([0x41, 0x42]));
    expect(written.length).toBe(1);
    expect(written[0]?.ptyId).toBe("pty-1");
    expect(written[0]?.data).toEqual(new Uint8Array([0x41, 0x42]));
  });

  it("uses focused PTY when ptyId is empty", () => {
    const written: Array<{ ptyId: string; data: Uint8Array }> = [];
    relay.setSink({
      writeInput(ptyId, data) {
        written.push({ ptyId, data });
      },
    });
    relay.setFocusedPty("pty-focused");

    relay.relay("", new Uint8Array([0x43]));
    expect(written[0]?.ptyId).toBe("pty-focused");
  });

  it("discards input when no PTY focused and empty ptyId", () => {
    const written: Array<{ ptyId: string; data: Uint8Array }> = [];
    relay.setSink({
      writeInput(ptyId, data) {
        written.push({ ptyId, data });
      },
    });

    relay.relay("", new Uint8Array([0x44]));
    expect(written.length).toBe(0);
  });

  it("measures latency samples", () => {
    relay.setSink({ writeInput() {} });
    relay.relay("pty-1", new Uint8Array([0x41]));
    relay.relay("pty-1", new Uint8Array([0x42]));
    expect(relay.getLatencySamples().length).toBe(2);
    expect(relay.getAverageLatencyMs()).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 average latency with no samples", () => {
    expect(relay.getAverageLatencyMs()).toBe(0);
  });
});
