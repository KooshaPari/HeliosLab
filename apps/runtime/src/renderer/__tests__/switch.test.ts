
import { switchRenderer, SwitchSameRendererError } from "../switch.js";
import { RendererRegistry } from "../registry.js";
import { RendererStateMachine } from "../state_machine.js";
import type { RendererAdapter, RendererConfig, RenderSurface, RendererState } from "../adapter.js";
import type { RendererCapabilities } from "../capabilities.js";
import type { RendererEventBus, RendererLifecycleEvent } from "../index.js";

const DEFAULT_CAPS: RendererCapabilities = {
  gpuAccelerated: true,
  colorDepth: 24,
  ligatureSupport: true,
  maxDimensions: { cols: 200, rows: 50 },
  inputModes: ["raw"],
  sixelSupport: false,
  italicSupport: true,
  strikethroughSupport: true,
};

const SURFACE: RenderSurface = {
  windowId: "win-1",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

const CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

function createMockAdapter(
  id: string,
  opts?: {
    initFail?: boolean;
    startFail?: boolean;
    stopFail?: boolean;
  }
): RendererAdapter {
  let state: RendererState = "uninitialized";
  return {
    id,
    version: "1.0.0",
    init: async () => {
      if (opts?.initFail) throw new Error(`${id} init failed`);
      state = "initializing";
    },
    start: async () => {
      if (opts?.startFail) throw new Error(`${id} start failed`);
      state = "running";
    },
    stop: async () => {
      if (opts?.stopFail) throw new Error(`${id} stop failed`);
      state = "stopped";
    },
    bindStream: () => {},
    unbindStream: () => {},
    handleInput: () => {},
    resize: () => {},
    queryCapabilities: () => DEFAULT_CAPS,
    getState: () => state,
    onCrash: () => {},
  };
}

function setupRegistry(from: RendererAdapter, to: RendererAdapter) {
  const reg = new RendererRegistry();
  reg.register(from);
  reg.register(to);
  reg.setActive(from.id);

  const sm = new RendererStateMachine();
  sm.transition("init");
  sm.transition("init_success");

  return { reg, sm };
}

// Traces to: FR-TXN-001 (atomic transactions), FR-TXN-004 (rollback on failure), FR-RND-004 (renderer switches)
describe("switchRenderer", () => {
  it("successfully switches renderers", async () => {
    const from = createMockAdapter("ghostty");
    const to = createMockAdapter("rio");
    const { reg, sm } = setupRegistry(from, to);
    const events: RendererLifecycleEvent[] = [];
    const bus: RendererEventBus = { publish: e => events.push(e) };

    await switchRenderer("ghostty", "rio", {
      registry: reg,
      stateMachine: sm,
      surface: SURFACE,
      config: CONFIG,
      boundStreams: new Map(),
      eventBus: bus,
    });

    expect(reg.getActive()?.id).toBe("rio");
    expect(sm.state).toBe("running");
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("renderer.switched");
  });

  it("throws for same renderer", async () => {
    const from = createMockAdapter("ghostty");
    const { reg, sm } = setupRegistry(from, createMockAdapter("rio"));

    await expect(
      switchRenderer("ghostty", "ghostty", {
        registry: reg,
        stateMachine: sm,
        surface: SURFACE,
        config: CONFIG,
        boundStreams: new Map(),
      })
    ).rejects.toThrow(SwitchSameRendererError);
  });

  it("rolls back on new renderer init failure", async () => {
    const from = createMockAdapter("ghostty");
    const to = createMockAdapter("rio", { initFail: true });
    const { reg, sm } = setupRegistry(from, to);
    const events: RendererLifecycleEvent[] = [];
    const bus: RendererEventBus = { publish: e => events.push(e) };

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: SURFACE,
        config: CONFIG,
        boundStreams: new Map(),
        eventBus: bus,
      })
    ).rejects.toThrow("rio init failed");

    // Should have rolled back
    expect(reg.getActive()?.id).toBe("ghostty");
    expect(sm.state).toBe("running");
    expect(events.some(e => e.type === "renderer.switch_failed")).toBe(true);
  });

  it("enters errored state on double failure", async () => {
    const from = createMockAdapter("ghostty", { initFail: true }); // rollback init will fail
    const to = createMockAdapter("rio", { startFail: true }); // switch start will fail
    const reg = new RendererRegistry();
    reg.register(from);
    reg.register(to);
    reg.setActive("ghostty");

    const sm = new RendererStateMachine();
    sm.transition("init");
    sm.transition("init_success");

    // Override from's init to fail (simulating rollback failure)
    // from is already set up with initFail: true
    const events: RendererLifecycleEvent[] = [];
    const bus: RendererEventBus = { publish: e => events.push(e) };

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: SURFACE,
        config: CONFIG,
        boundStreams: new Map(),
        eventBus: bus,
      })
    ).rejects.toThrow();

    expect(sm.state).toBe("errored");
    expect(events.some(e => e.type === "renderer.errored")).toBe(true);
  });

  it("rebinds streams on successful switch", async () => {
    const boundPtys: string[] = [];
    const unboundPtys: string[] = [];
    const from = {
      ...createMockAdapter("ghostty"),
      unbindStream: (ptyId: string) => {
        unboundPtys.push(ptyId);
      },
    };
    const to = {
      ...createMockAdapter("rio"),
      bindStream: (ptyId: string) => {
        boundPtys.push(ptyId);
      },
    };
    const { reg, sm } = setupRegistry(from, to);

    const streams = new Map<string, ReadableStream<Uint8Array>>();
    streams.set("pty-1", new ReadableStream());
    streams.set("pty-2", new ReadableStream());

    await switchRenderer("ghostty", "rio", {
      registry: reg,
      stateMachine: sm,
      surface: SURFACE,
      config: CONFIG,
      boundStreams: streams,
    });

    expect(unboundPtys.sort()).toEqual(["pty-1", "pty-2"]);
    expect(boundPtys.sort()).toEqual(["pty-1", "pty-2"]);
  });
});
