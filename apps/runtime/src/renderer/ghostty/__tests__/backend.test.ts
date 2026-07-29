/**
 * Unit tests for GhosttyBackend (T001).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  GhosttyBackend,
  GhosttyNotInitializedError,
  GhosttyNotRunningError,
  GhosttyAlreadyInitializedError,
} from "../backend.js";
import type { RendererConfig, RenderSurface } from "../../adapter.js";

const TEST_CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

const TEST_SURFACE: RenderSurface = {
  windowId: "test-window-1",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

describe("GhosttyBackend", () => {
  let backend: GhosttyBackend;

  beforeEach(() => {
    backend = new GhosttyBackend("0.1.0-test");
  });

  test("has correct id and version", () => {
    expect(backend.id).toBe("ghostty");
    expect(backend.version).toBe("0.1.0-test");
  });

  test("initial state is uninitialized", () => {
    expect(backend.getState()).toBe("uninitialized");
  });

  test("init transitions to running state", async () => {
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
  });

  test("init twice without stop throws", async () => {
    await backend.init(TEST_CONFIG);
    await expect(backend.init(TEST_CONFIG)).rejects.toThrow(GhosttyAlreadyInitializedError);
  });

  test("start without init throws", async () => {
    await expect(backend.start(TEST_SURFACE)).rejects.toThrow(GhosttyNotInitializedError);
  });

  test("stop when uninitialized is idempotent", async () => {
    await backend.stop(); // Should not throw
    expect(backend.getState()).toBe("uninitialized");
  });

  test("stop after init transitions to stopped", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });

  test("stop is idempotent (double stop)", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    await backend.stop(); // Should not throw
    expect(backend.getState()).toBe("stopped");
  });

  test("bindStream before start throws", () => {
    const stream = new ReadableStream<Uint8Array>();
    expect(() => backend.bindStream("pty-1", stream)).toThrow(GhosttyNotRunningError);
  });

  test("bindStream after init stores binding", async () => {
    await backend.init(TEST_CONFIG);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    // Should not throw when state is "running"
    backend.bindStream("pty-1", stream);
  });

  test("unbindStream for unknown ptyId is a no-op", async () => {
    await backend.init(TEST_CONFIG);
    backend.unbindStream("nonexistent"); // Should not throw
  });

  test("handleInput when not running throws", () => {
    expect(() => backend.handleInput("pty-1", new Uint8Array([0x41]))).toThrow(
      GhosttyNotRunningError
    );
  });

  test("resize when not running is silent", () => {
    // Should not throw
    backend.resize("pty-1", 80, 24);
  });

  test("queryCapabilities returns valid object", () => {
    const caps = backend.queryCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.gpuAccelerated).toBe("boolean");
    expect(caps.colorDepth).toBe(24);
    expect(Array.isArray(caps.inputModes)).toBe(true);
  });

  test("getState reflects lifecycle", async () => {
    expect(backend.getState()).toBe("uninitialized");
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });

  test("onCrash registers handler", () => {
    let called = false;
    backend.onCrash(() => {
      called = true;
    });
    // Handler is registered but not called yet
    expect(called).toBe(false);
  });

  test("re-init after stop is allowed", async () => {
    await backend.init(TEST_CONFIG);
    await backend.stop();
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
  });

  test("implements all RendererAdapter methods", () => {
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
});
