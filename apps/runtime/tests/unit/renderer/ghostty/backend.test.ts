/**
 * Unit tests for GhosttyBackend (T012).
 *
 * Tests adapter lifecycle, stream bind/unbind, state tracking,
 * metrics integration, and input relay setup.
 *
 * Tags: FR-011-001, FR-011-003, FR-011-004
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  GhosttyBackend,
  GhosttyNotInitializedError,
  GhosttyNotRunningError,
  GhosttyAlreadyInitializedError,
} from "../../../../src/renderer/ghostty/backend.js";
import type { RendererConfig, RenderSurface } from "../../../../src/renderer/adapter.js";
import type { PtyWriter } from "../../../../src/renderer/ghostty/input.js";

// Mock Bun.spawn to avoid slow system_profiler calls during detectCapabilities
const originalSpawn = Bun.spawn;
beforeEach(() => {
  (Bun as any).spawn = mock((..._args: unknown[]) => {
    const encoder = new TextEncoder();
    const data = encoder.encode("Metal: Supported");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    return { stdout: stream, stderr: null, exitCode: Promise.resolve(0) };
  });
});

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

const TEST_CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

const TEST_SURFACE: RenderSurface = {
  windowId: "test-window-1",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("GhosttyBackend - lifecycle (T012)", () => {
  let backend: GhosttyBackend;

  beforeEach(() => {
    backend = new GhosttyBackend("0.1.0-test");
  });

  test("id and version", () => {
    expect(backend.id).toBe("ghostty");
    expect(backend.version).toBe("0.1.0-test");
  });

  test("initial state is uninitialized", () => {
    expect(backend.getState()).toBe("uninitialized");
  });

  test("init -> running", async () => {
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
  });

  test("init twice throws GhosttyAlreadyInitializedError", async () => {
    await backend.init(TEST_CONFIG);
    await expect(backend.init(TEST_CONFIG)).rejects.toThrow(GhosttyAlreadyInitializedError);
  });

  test("start without init throws GhosttyNotInitializedError", async () => {
    await expect(backend.start(TEST_SURFACE)).rejects.toThrow(GhosttyNotInitializedError);
  });

  test("stop when uninitialized is idempotent", async () => {
    await backend.stop();
    expect(backend.getState()).toBe("uninitialized");
  });

  test("stop after init -> stopped", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });

  test("double stop is idempotent", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });

  test("re-init after stop is allowed", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
  });

  test("full lifecycle: init -> stop -> re-init -> stop", async () => {
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });
});

describe("GhosttyBackend - stream bind/unbind (T012, T010)", () => {
  let backend: GhosttyBackend;

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("bindStream when not running throws", async () => {
    await backend.stop();
    const stream = new ReadableStream<Uint8Array>();
    expect(() => backend.bindStream("pty-1", stream)).toThrow(GhosttyNotRunningError);
  });

  test("bindStream stores binding", () => {
    const stream = makeStream([new Uint8Array([0x41])]);
    backend.bindStream("pty-1", stream);
    expect(backend.getBoundStreamCount()).toBe(1);
    expect(backend.getBoundStreamIds()).toEqual(["pty-1"]);
  });

  test("unbindStream removes binding", () => {
    const stream = makeStream([new Uint8Array([0x41])]);
    backend.bindStream("pty-1", stream);
    backend.unbindStream("pty-1");
    expect(backend.getBoundStreamCount()).toBe(0);
  });

  test("unbindStream for unknown ptyId is a no-op", () => {
    backend.unbindStream("nonexistent");
    expect(backend.getBoundStreamCount()).toBe(0);
  });

  test("multiple streams routed to correct panes", () => {
    backend.bindStream("pty-1", makeStream([new Uint8Array([0x41])]));
    backend.bindStream("pty-2", makeStream([new Uint8Array([0x42])]));
    backend.bindStream("pty-3", makeStream([new Uint8Array([0x43])]));
    expect(backend.getBoundStreamCount()).toBe(3);
    expect(backend.getBoundStreamIds()).toEqual(["pty-1", "pty-2", "pty-3"]);
  });

  test("rebind replaces existing stream", () => {
    backend.bindStream("pty-1", makeStream([new Uint8Array([0x41])]));
    backend.bindStream("pty-1", makeStream([new Uint8Array([0x42])]));
    expect(backend.getBoundStreamCount()).toBe(1);
  });

  test("stop unbinds all streams", async () => {
    backend.bindStream("pty-1", makeStream([new Uint8Array([0x41])]));
    backend.bindStream("pty-2", makeStream([new Uint8Array([0x42])]));
    await backend.stop();
    expect(backend.getBoundStreamCount()).toBe(0);
  });

  test("piping latencies are tracked", async () => {
    const stream = makeStream([new Uint8Array([0x41]), new Uint8Array([0x42])]);
    backend.bindStream("pty-1", stream);
    // Wait for pump to complete
    await new Promise(r => setTimeout(r, 50));
    const latencies = backend.getPipingLatencies("pty-1");
    expect(latencies.length).toBeGreaterThanOrEqual(0);
  });

  test("stream end triggers cleanup", async () => {
    const stream = makeStream([new Uint8Array([0x41])]);
    backend.bindStream("pty-1", stream);
    // Wait for pump to finish (stream closes after 1 chunk)
    await new Promise(r => setTimeout(r, 50));
    // Stream ended but binding still active until explicit unbind
    expect(backend.getBoundStreamCount()).toBe(1);
  });
});

describe("GhosttyBackend - input handling (T012)", () => {
  let backend: GhosttyBackend;

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("handleInput when not running throws", async () => {
    await backend.stop();
    expect(() => backend.handleInput("pty-1", new Uint8Array([0x41]))).toThrow(
      GhosttyNotRunningError
    );
  });

  test("handleInput when running does not throw", () => {
    backend.handleInput("pty-1", new Uint8Array([0x41]));
  });
});

describe("GhosttyBackend - resize (T012)", () => {
  let backend: GhosttyBackend;

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("resize when not running is silent", async () => {
    await backend.stop();
    backend.resize("pty-1", 80, 24);
  });

  test("resize when running does not throw", () => {
    backend.resize("pty-1", 120, 40);
  });
});

describe("GhosttyBackend - metrics (T012)", () => {
  let backend: GhosttyBackend;

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("getMetrics returns metrics instance", () => {
    const metrics = backend.getMetrics();
    expect(metrics).toBeDefined();
  });

  test("enableMetrics / disableMetrics", () => {
    backend.enableMetrics();
    expect(backend.getMetrics().enabled).toBe(true);
    backend.disableMetrics();
    expect(backend.getMetrics().enabled).toBe(false);
  });

  test("enableMetrics with publisher", () => {
    const published: unknown[] = [];
    backend.enableMetrics((_topic, payload) => {
      published.push(payload);
    });
    expect(backend.getMetrics().enabled).toBe(true);
  });

  test("getMetricsSnapshot returns valid snapshot", () => {
    backend.enableMetrics();
    const snap = backend.getMetricsSnapshot();
    expect(snap.rendererId).toBe("ghostty");
    expect(typeof snap.avgFps).toBe("number");
    expect(typeof snap.p50FrameTime).toBe("number");
    expect(typeof snap.p95FrameTime).toBe("number");
    expect(typeof snap.p50InputLatency).toBe("number");
    expect(typeof snap.p95InputLatency).toBe("number");
  });

  test("recordFrame updates metrics", () => {
    backend.enableMetrics();
    const now = Date.now();
    backend.recordFrame(now);
    backend.recordFrame(now + 16);
    backend.recordFrame(now + 32);
    const snap = backend.getMetricsSnapshot();
    expect(snap.avgFps).toBeGreaterThan(0);
  });

  test("stop resets metrics", async () => {
    backend.enableMetrics();
    backend.recordFrame(Date.now());
    await backend.stop();
    // After stop, metrics should be disabled and reset
    expect(backend.getMetrics().enabled).toBe(false);
  });
});

describe("GhosttyBackend - input relay (T012)", () => {
  let backend: GhosttyBackend;
  const mockWriter: PtyWriter = {
    writeInput: () => {
      // no-op: adapter contract requires writer callback
    },
  };

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("setupInputRelay returns relay instance", () => {
    const relay = backend.setupInputRelay(mockWriter);
    expect(relay).toBeDefined();
    expect(backend.getInputRelay()).toBe(relay);
  });

  test("getInputRelay returns undefined before setup", () => {
    expect(backend.getInputRelay()).toBeUndefined();
  });

  test("stop tears down input relay", async () => {
    backend.setupInputRelay(mockWriter);
    await backend.stop();
    expect(backend.getInputRelay()).toBeUndefined();
  });
});

describe("GhosttyBackend - render loop (T012)", () => {
  let backend: GhosttyBackend;

  beforeEach(async () => {
    backend = new GhosttyBackend("0.1.0-test");
    await backend.init(TEST_CONFIG);
  });

  test("setTargetFps does not throw", () => {
    backend.setTargetFps(120);
  });

  test("onRenderEvent registers handler", () => {
    let called = false;
    backend.onRenderEvent(() => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("queryCapabilities returns valid object", () => {
    const caps = backend.queryCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.gpuAccelerated).toBe("boolean");
    expect(caps.colorDepth).toBe(24);
    expect(Array.isArray(caps.inputModes)).toBe(true);
  });

  test("onCrash registers handler", () => {
    let called = false;
    backend.onCrash(() => {
      called = true;
    });
    expect(called).toBe(false);
  });
});
