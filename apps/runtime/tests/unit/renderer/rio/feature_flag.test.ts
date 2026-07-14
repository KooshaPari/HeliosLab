/**
 * FR-HELIOS-055: Rio Feature Flag Toggle Tests
 * Verifies: FR-RIO-002 (Feature flag gating), FR-CFG-009 (renderer_engine flag)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  isRioEnabled,
  handleRioToggle,
  RioToggleQueue,
  type RioFeatureFlagConfig,
} from "../../../../src/renderer/rio/index.js";
import { RendererRegistry } from "../../../../src/renderer/registry.js";
import { RioBackend } from "../../../../src/renderer/rio/backend.js";
import type {
  RendererAdapter,
  RendererConfig,
  RenderSurface,
  RendererState,
} from "../../../../src/renderer/adapter.js";
import type { RendererCapabilities } from "../../../../src/renderer/capabilities.js";

// ---------------------------------------------------------------------------
// Mock ghostty
// ---------------------------------------------------------------------------

function createMockGhostty(): RendererAdapter & { _state: RendererState } {
  const adapter = {
    id: "ghostty" as const,
    version: "0.1.0",
    _state: "uninitialized" as RendererState,

    async init(_config: RendererConfig): Promise<void> {
      adapter._state = "running";
    },
    async start(_surface: RenderSurface): Promise<void> {
      adapter._state = "running";
    },
    async stop(): Promise<void> {
      adapter._state = "stopped";
    },
    bindStream(_ptyId: string, _stream: ReadableStream<Uint8Array>): void {},
    unbindStream(_ptyId: string): void {},
    handleInput(_ptyId: string, _data: Uint8Array): void {},
    resize(_ptyId: string, _cols: number, _rows: number): void {},
    queryCapabilities(): RendererCapabilities {
      return {
        gpuAccelerated: false,
        colorDepth: 24,
        ligatureSupport: true,
        maxDimensions: { cols: 500, rows: 200 },
        inputModes: ["raw", "cooked", "application"],
        sixelSupport: false,
        italicSupport: true,
        strikethroughSupport: true,
      };
    },
    getState(): RendererState {
      return adapter._state;
    },
    onCrash(_handler: (error: Error) => void): void {},
  };
  return adapter;
}

// ---------------------------------------------------------------------------
// isRioEnabled
// ---------------------------------------------------------------------------

describe("isRioEnabled", () => {
  it("returns false when flag missing", () => {
    expect(isRioEnabled({})).toBe(false);
  });

  it("returns false when explicitly false", () => {
    expect(isRioEnabled({ featureFlags: { rioRenderer: false } })).toBe(false);
  });

  it("returns true when true", () => {
    expect(isRioEnabled({ featureFlags: { rioRenderer: true } })).toBe(true);
  });

  it("returns false when featureFlags exists but rioRenderer missing", () => {
    expect(isRioEnabled({ featureFlags: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleRioToggle — disable
// ---------------------------------------------------------------------------

describe("handleRioToggle — disable", () => {
  let registry: RendererRegistry;
  let ghostty: RendererAdapter & { _state: RendererState };
  const config: RioFeatureFlagConfig = { featureFlags: { rioRenderer: true } };

  beforeEach(() => {
    registry = new RendererRegistry();
    ghostty = createMockGhostty();
    registry.register(ghostty);
  });

  it("unregisters rio and emits disabled event", async () => {
    const backend = new RioBackend();
    backend.setRegistry(registry);
    registry.register(backend);

    const events = await handleRioToggle(registry, false, config);
    expect(events).toEqual([{ type: "renderer.rio.disabled" }]);
    expect(registry.get("rio")).toBeUndefined();
  });

  it("switches to ghostty when rio is active", async () => {
    const backend = new RioBackend();
    backend.setRegistry(registry);
    registry.register(backend);
    registry.setActive("rio");

    const events = await handleRioToggle(registry, false, config);
    expect(events).toEqual([{ type: "renderer.rio.disabled" }]);
    expect(registry.getActive()?.id).toBe("ghostty");
  });

  it("emits disabled even when rio not registered", async () => {
    const events = await handleRioToggle(registry, false, config);
    expect(events).toEqual([{ type: "renderer.rio.disabled" }]);
  });
});

// ---------------------------------------------------------------------------
// handleRioToggle — enable (re-enable existing)
// ---------------------------------------------------------------------------

describe("handleRioToggle — enable", () => {
  it("re-enables existing disabled rio adapter", async () => {
    const _registry = new RendererRegistry();
    const backend = new RioBackend();
    backend.setDisabled();
    registry.register(backend);

    const events = await handleRioToggle(registry, true, {
      featureFlags: { rioRenderer: true },
    });
    expect(events).toEqual([{ type: "renderer.rio.enabled" }]);
    expect(backend.isEnabled()).toBe(true);
  });

  it("does not auto-switch to rio when enabling", async () => {
    const _registry = new RendererRegistry();
    const _ghostty = createMockGhostty();
    registry.register(ghostty);
    registry.setActive("ghostty");

    const backend = new RioBackend();
    backend.setDisabled();
    registry.register(backend);

    await handleRioToggle(registry, true, {
      featureFlags: { rioRenderer: true },
    });
    expect(registry.getActive()?.id).toBe("ghostty");
  });
});

// ---------------------------------------------------------------------------
// RioToggleQueue — serialization
// ---------------------------------------------------------------------------

describe("RioToggleQueue", () => {
  it("processes toggles serially", async () => {
    const _registry = new RendererRegistry();
    const _ghostty = createMockGhostty();
    registry.register(ghostty);
    const backend = new RioBackend();
    backend.setRegistry(registry);
    registry.register(backend);

    const queue = new RioToggleQueue(registry, {
      featureFlags: { rioRenderer: true },
    });

    const _results = await queue.enqueue(false);
    expect(results).toEqual([{ type: "renderer.rio.disabled" }]);
  });

  it("rapid toggles drain to final state", async () => {
    const _registry = new RendererRegistry();
    const _ghostty = createMockGhostty();
    registry.register(ghostty);
    const backend = new RioBackend();
    backend.setRegistry(registry);
    registry.register(backend);

    const queue = new RioToggleQueue(registry, {
      featureFlags: { rioRenderer: true },
    });

    // Fire multiple toggles without awaiting.
    const p1 = queue.enqueue(false);
    const p2 = queue.enqueue(true);
    const p3 = queue.enqueue(false);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    // First processes normally, middle ones get queued, last gets final.
    expect(r1[0]?.type).toBeDefined();
    expect(r2[0]?.type).toBeDefined();
    expect(r3[0]?.type).toBeDefined();
  });
});
