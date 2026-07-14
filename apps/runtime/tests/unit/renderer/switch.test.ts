/**
 * FR-HELIOS-056: Renderer Switch Transaction Tests
 * Verifies: FR-TXN-001 (Atomic transactions), FR-TXN-002 (Hot-swap), FR-TXN-004 (Automatic rollback), FR-TXN-008 (Lifecycle events)
 * Traces to: FR-RND-004 (renderer switch as transaction), FR-TXN-007 (reject concurrent switches)
 */
import { describe, expect, it } from "bun:test";
import {
  switchRenderer,
  SwitchSameRendererError,
  
} from "../../../src/renderer/switch.js";
import { RendererRegistry } from "../../../src/renderer/registry.js";
import { RendererStateMachine } from "../../../src/renderer/state_machine.js";
import type { RendererEventBus, RendererLifecycleEvent } from "../../../src/renderer/index.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  MockRendererAdapter,
  TEST_SURFACE,
  TEST_CONFIG,
} from "../../helpers/mock_adapter.js";

function setup(from: MockRendererAdapter, to: MockRendererAdapter) {
  const reg = new RendererRegistry();
  reg.register(from);
  reg.register(to);
  reg.setActive(from.id);
  const sm = new RendererStateMachine();
  sm.transition("init");
  sm.transition("init_success");
  const events: RendererLifecycleEvent[] = [];
  const bus: RendererEventBus = { publish: e => events.push(e) };
  return { reg, sm, events, bus };
}

describe("switchRenderer", () => {
  it("successfully switches renderers (SC-010-001)", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter();
    const { reg, sm, events, bus } = setup(from, to);

    await switchRenderer("ghostty", "rio", {
      registry: reg,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams: new Map(),
      eventBus: bus,
    });

    expect(reg.getActive()?.id).toBe("rio");
    expect(sm.state).toBe("running");
    expect(events[0]!.type).toBe("renderer.switched");
  });

  it("throws SwitchSameRendererError for same renderer", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter();
    const { reg, sm } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "ghostty", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
      })
    ).rejects.toThrow(SwitchSameRendererError);
  });

  it("rolls back on new renderer init failure (SC-010-001)", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter({ initFail: true });
    const { reg, sm, events, bus } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
        eventBus: bus,
      })
    ).rejects.toThrow("rio init failed");

    expect(reg.getActive()?.id).toBe("ghostty");
    expect(sm.state).toBe("running");
    expect(events.some(e => e.type === "renderer.switch_failed")).toBe(true);
  });

  it("rolls back on new renderer start failure", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter({ startFail: true });
    const { reg, sm } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
      })
    ).rejects.toThrow("rio start failed");

    expect(reg.getActive()?.id).toBe("ghostty");
    expect(sm.state).toBe("running");
  });

  it("enters errored state on double failure (SC-010-001)", async () => {
    const from = new MockGhosttyAdapter({ initFail: true }); // rollback will fail
    const to = new MockRioAdapter({ startFail: true }); // switch will fail
    const { reg, sm, events, bus } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
        eventBus: bus,
      })
    ).rejects.toThrow();

    expect(sm.state).toBe("errored");
    expect(events.some(e => e.type === "renderer.errored")).toBe(true);
  });

  it("rebinds streams on successful switch", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter();
    const { reg, sm } = setup(from, to);

    const streams = new Map<string, ReadableStream<Uint8Array>>();
    streams.set("pty-1", new ReadableStream());
    streams.set("pty-2", new ReadableStream());

    await switchRenderer("ghostty", "rio", {
      registry: reg,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams: streams,
    });

    expect(from.unboundPtyIds.sort()).toEqual(["pty-1", "pty-2"]);
    expect([...to.boundStreams.keys()].sort()).toEqual(["pty-1", "pty-2"]);
  });

  it("times out for slow renderer", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter({ initDelay: 200 });
    const { reg, sm } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
        timeoutMs: 50,
      })
    ).rejects.toThrow();
  });

  it("throws for unregistered source renderer", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter();
    const { reg, sm } = setup(from, to);

    await expect(
      switchRenderer("unknown", "rio", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
      })
    ).rejects.toThrow("not registered");
  });

  it("throws for unregistered target renderer", async () => {
    const from = new MockGhosttyAdapter();
    const to = new MockRioAdapter();
    const { reg, sm } = setup(from, to);

    await expect(
      switchRenderer("ghostty", "unknown", {
        registry: reg,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
      })
    ).rejects.toThrow("not registered");
  });
});
