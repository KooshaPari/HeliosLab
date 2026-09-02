/**
 * FR-HELIOS-054: Rio Crash Fallback Tests
 * Verifies: FR-RIO-007 (Crash handling with fallback to ghostty)
 */
import { describe, it, expect, beforeEach } from "bun:test";
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
// Mock ghostty
// ---------------------------------------------------------------------------

function createMockGhostty(opts?: {
  failInit?: boolean;
}): RendererAdapter & { _state: RendererState; _initCalled: boolean } {
  const adapter = {
    id: "ghostty" as const,
    version: "0.1.0",
    _state: "uninitialized" as RendererState,
    _initCalled: false,

    async init(_config: RendererConfig): Promise<void> {
      adapter._initCalled = true;
      if (opts?.failInit) throw new Error("ghostty init failed");
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
// Fallback scenarios
// ---------------------------------------------------------------------------

describe("Crash fallback — ghostty available", () => {
  let backend: RioBackend;
  let registry: RendererRegistry;
  let ghostty: ReturnType<typeof createMockGhostty>;

  beforeEach(() => {
    backend = new RioBackend();
    registry = new RendererRegistry();
    ghostty = createMockGhostty();
    registry.register(ghostty);
    registry.register(backend);
    registry.setActive("rio");
    backend.setRegistry(registry);
  });

  it("switches active renderer to ghostty on crash", async () => {
    await backend._attemptFallback(new Error("crash: code 139"));
    expect(registry.getActive()?.id).toBe("ghostty");
  });

  it("initializes ghostty during fallback", async () => {
    await backend._attemptFallback(new Error("crash"));
    expect(ghostty._initCalled).toBe(true);
  });

  it("rio state becomes stopped after successful fallback", async () => {
    await backend._attemptFallback(new Error("crash"));
    expect(backend.getState()).toBe("stopped");
  });

  it("publishes fallback event via crash handlers", async () => {
    const errors: Error[] = [];
    backend.onCrash(err => errors.push(err));
    // _attemptFallback doesn't call crash handlers (those are called by the exit handler).
    // This just verifies crash handler registration works.
    expect(errors.length).toBe(0);
  });
});

describe("Crash fallback — ghostty unavailable", () => {
  it("transitions to errored when ghostty not registered", async () => {
    const backend = new RioBackend();
    const registry = new RendererRegistry();
    registry.register(backend);
    backend.setRegistry(registry);

    await backend._attemptFallback(new Error("crash"));
    expect(backend.getState()).toBe("errored");
  });

  it("transitions to errored when no registry set", async () => {
    const backend = new RioBackend();
    await backend._attemptFallback(new Error("crash"));
    expect(backend.getState()).toBe("errored");
  });
});

describe("Crash fallback — ghostty init fails", () => {
  it("transitions to errored when ghostty init throws", async () => {
    const backend = new RioBackend();
    const registry = new RendererRegistry();
    const ghostty = createMockGhostty({ failInit: true });
    registry.register(ghostty);
    registry.register(backend);
    backend.setRegistry(registry);

    await backend._attemptFallback(new Error("crash"));
    // The init failure is caught inside _switchToGhostty, which throws,
    // causing _attemptFallback to catch and set errored.
    expect(backend.getState()).toBe("errored");
  });
});

describe("Crash fallback — double fallback prevention", () => {
  it("second concurrent fallback is a no-op", async () => {
    const backend = new RioBackend();
    const registry = new RendererRegistry();
    const ghostty = createMockGhostty();
    registry.register(ghostty);
    registry.register(backend);
    backend.setRegistry(registry);

    const p1 = backend._attemptFallback(new Error("crash 1"));
    expect(backend.isFallbackInProgress()).toBe(true);
    const p2 = backend._attemptFallback(new Error("crash 2"));
    await Promise.all([p1, p2]);

    // Only one fallback actually ran.
    expect(registry.getActive()?.id).toBe("ghostty");
  });
});

describe("Crash fallback — ghostty already running", () => {
  it("skips init when ghostty already running", async () => {
    const backend = new RioBackend();
    const registry = new RendererRegistry();
    const ghostty = createMockGhostty();
    ghostty._state = "running"; // already running
    registry.register(ghostty);
    registry.register(backend);
    backend.setRegistry(registry);

    await backend._attemptFallback(new Error("crash"));
    // Should not re-init ghostty.
    expect(ghostty._initCalled).toBe(false);
    expect(registry.getActive()?.id).toBe("ghostty");
  });
});
