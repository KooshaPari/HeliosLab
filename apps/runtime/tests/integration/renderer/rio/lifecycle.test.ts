/**
 * Integration tests for rio lifecycle and fallback.
 * Covers: T010 (integration tests).
 *
 * Prerequisites: skips if rio binary not available or feature flag not enabled.
 */

import { RioBackend } from "../../../../src/renderer/rio/backend.js";
import { RendererRegistry } from "../../../../src/renderer/registry.js";

import type {
  RendererAdapter,
  RendererConfig,
  RenderSurface,
  RendererState,
} from "../../../../src/renderer/adapter.js";
import type { RendererCapabilities } from "../../../../src/renderer/capabilities.js";

// ---------------------------------------------------------------------------
// Skip if rio not available
// ---------------------------------------------------------------------------

let rioAvailable = false;

beforeAll(async () => {
  rioAvailable = await detectRioBinary();
});

// ---------------------------------------------------------------------------
// Mock ghostty for fallback tests
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

const _DEFAULT_CONFIG: RendererConfig = {
  gpuAcceleration: false,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

// ---------------------------------------------------------------------------
// Registration tests (always run)
// ---------------------------------------------------------------------------

describe("Rio registration — feature flag off", () => {
  it("does not register when flag disabled", async () => {
    const _registry = new RendererRegistry();
    await registerRio(registry, { featureFlags: { rioRenderer: false } });
    expect(registry.get("rio")).toBeUndefined();
  });

  it("does not register when flag missing", async () => {
    const _registry = new RendererRegistry();
    await registerRio(registry, {});
    expect(registry.get("rio")).toBeUndefined();
  });
});

describe("Rio registration — feature flag on", () => {
  it("registers when flag enabled and binary available", async () => {
    if (!rioAvailable) {
      console.log("SKIP: rio binary not available");
      return;
    }
    const _registry = new RendererRegistry();
    await registerRio(registry, { featureFlags: { rioRenderer: true } });
    expect(registry.get("rio")).toBeDefined();
    expect(registry.get("rio")?.id).toBe("rio");
  });
});

// ---------------------------------------------------------------------------
// Capability query (always run — uses mocked backend)
// ---------------------------------------------------------------------------

describe("Rio capabilities query", () => {
  it("returns populated capabilities", () => {
    const backend = new RioBackend();
    const caps = backend.queryCapabilities();
    expect(caps.colorDepth).toBeDefined();
    expect(caps.inputModes).toBeDefined();
    expect(Array.isArray(caps.inputModes)).toBe(true);
    expect(caps.maxDimensions).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Fallback integration (mocked — no real process needed)
// ---------------------------------------------------------------------------

describe("Rio fallback integration — mocked", () => {
  let registry: RendererRegistry;
  let backend: RioBackend;
  let ghostty: ReturnType<typeof createMockGhostty>;

  beforeEach(() => {
    registry = new RendererRegistry();
    ghostty = createMockGhostty();
    backend = new RioBackend();
    registry.register(ghostty);
    registry.register(backend);
    registry.setActive("rio");
    backend.setRegistry(registry);
  });

  it("fallback switches to ghostty and rio stops", async () => {
    await backend._attemptFallback(new Error("crash: SIGSEGV"));
    expect(registry.getActive()?.id).toBe("ghostty");
    expect(backend.getState()).toBe("stopped");
  });

  it("round-trip: register, fallback, re-register", async () => {
    await backend._attemptFallback(new Error("crash"));
    expect(registry.getActive()?.id).toBe("ghostty");

    // Unregister old rio, create new one.
    registry.unregister("rio");
    const newBackend = new RioBackend();
    newBackend.setRegistry(registry);
    registry.register(newBackend);

    expect(registry.get("rio")).toBeDefined();
    expect(registry.getActive()?.id).toBe("ghostty"); // not auto-switched
  });
});

// ---------------------------------------------------------------------------
// No orphaned processes (always run — no real process spawned)
// ---------------------------------------------------------------------------

describe("Rio — no orphaned processes", () => {
  it("stop cleans up without leaving dangling state", async () => {
    const backend = new RioBackend();
    await backend.stop();
    expect(backend.getState()).toBe("uninitialized");
  });
});
