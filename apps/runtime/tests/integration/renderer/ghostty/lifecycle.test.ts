/**
 * FR-HELIOS-082: Ghostty Lifecycle Integration Tests
 * Verifies: FR-GHT-001 (Renderer adapter interface), FR-GHT-002 (Ghostty process management), FR-GHT-007 (Crash handling)
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { GhosttyBackend } from "../../../../src/renderer/ghostty/backend.js";
import { isGhosttyAvailable } from "../../../../src/renderer/ghostty/index.js";
import { RendererRegistry } from "../../../../src/renderer/registry.js";
import type { RendererConfig, RenderSurface } from "../../../../src/renderer/adapter.js";

const TEST_CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

const _TEST_SURFACE: RenderSurface = {
  windowId: "integration-test-window",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

let ghosttyAvailable = false;

beforeAll(async () => {
  ghosttyAvailable = await isGhosttyAvailable();
  if (!ghosttyAvailable) {
    console.warn("[T013] Ghostty binary not found -- integration tests will be skipped.");
  }
});

function skipUnlessGhostty() {
  if (!ghosttyAvailable) {
    return true;
  }
  return false;
}

describe("Ghostty integration - lifecycle (T013)", () => {
  let backend: GhosttyBackend | undefined;

  afterEach(async () => {
    if (backend !== undefined) {
      try {
        await backend.stop();
    // eslint-disable-next-line no-unused-vars
      } catch (_err) {
        // Ignore cleanup errors
      }
      backend = undefined;
    }
  });

  test("init and stop without ghostty binary (always runs)", async () => {
    // This test verifies init/stop when ghostty process start is not called.
    backend = new GhosttyBackend("0.0.0-test");
    await backend.init(TEST_CONFIG);
    expect(backend.getState()).toBe("running");
    await backend.stop();
    expect(backend.getState()).toBe("stopped");
  });

  test("bind mock PTY stream and verify consumption", async () => {
    if (skipUnlessGhostty()) return;

    backend = new GhosttyBackend("integration");
    await backend.init(TEST_CONFIG);

    const chunks: Uint8Array[] = [
      new TextEncoder().encode("hello"),
      new TextEncoder().encode(" world\r\n"),
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });

    backend.bindStream("pty-int-1", stream);
    // Wait for pump to consume
    await new Promise(r => setTimeout(r, 100));

    expect(backend.getBoundStreamCount()).toBe(1);
  });

  test("query capabilities reflects system GPU", async () => {
    backend = new GhosttyBackend("0.0.0-test");
    await backend.init(TEST_CONFIG);
    const caps = backend.queryCapabilities();
    expect(typeof caps.gpuAccelerated).toBe("boolean");
    expect(caps.colorDepth).toBe(24);
  });

  test("register ghostty with renderer registry", () => {
    const _registry = new RendererRegistry();
    backend = new GhosttyBackend("0.0.0-test");
    registry.register(backend);
    expect(registry.get("ghostty")).toBe(backend);
    expect(registry.list().length).toBe(1);
    registry.unregister("ghostty");
  });

  test("multiple bind/unbind cycles do not leak", async () => {
    backend = new GhosttyBackend("0.0.0-test");
    await backend.init(TEST_CONFIG);

    for (let i = 0; i < 10; i++) {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      });
      backend.bindStream(`pty-${i}`, stream);
    }

    expect(backend.getBoundStreamCount()).toBe(10);

    for (let i = 0; i < 10; i++) {
      backend.unbindStream(`pty-${i}`);
    }

    expect(backend.getBoundStreamCount()).toBe(0);
  });
});

describe("Ghostty integration - GPU surface (T013, T011)", () => {
  test("surface GPU status with GPU available", async () => {
    const backend = new GhosttyBackend("0.0.0-test");
    await backend.init(TEST_CONFIG);

    // The surface is managed internally; we verify capabilities
    const caps = backend.queryCapabilities();
    expect(typeof caps.gpuAccelerated).toBe("boolean");

    await backend.stop();
  });
});
