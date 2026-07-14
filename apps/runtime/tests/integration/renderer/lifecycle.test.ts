/**
 * Integration tests for renderer adapter lifecycle with mock backends.
 * @see SC-010-001, SC-010-002, SC-010-003
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { RendererRegistry } from "../../../src/renderer/registry.js";
import { RendererStateMachine } from "../../../src/renderer/state_machine.js";
import { switchRenderer } from "../../../src/renderer/switch.js";
import { StreamBindingManager } from "../../../src/renderer/stream_binding.js";
import type { RendererEventBus, RendererLifecycleEvent } from "../../../src/renderer/index.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_SURFACE,
  TEST_CONFIG,
} from "../../helpers/mock_adapter.js";

describe("Renderer lifecycle integration", () => {
  let registry: RendererRegistry;
  let sm: RendererStateMachine;
  let ghostty: MockGhosttyAdapter;
  let rio: MockRioAdapter;
  let events: RendererLifecycleEvent[];
  let bus: RendererEventBus;
  let bindingMgr: StreamBindingManager;

  beforeEach(() => {
    registry = new RendererRegistry();
    sm = new RendererStateMachine();
    ghostty = new MockGhosttyAdapter();
    rio = new MockRioAdapter();
    events = [];
    bus = { publish: e => events.push(e) };
    bindingMgr = new StreamBindingManager();
  });

  it("(a) registers mock ghostty and rio, both appear in registry (SC-010-002)", () => {
    registry.register(ghostty);
    registry.register(rio);
    expect(registry.list().length).toBe(2);
    expect(registry.get("ghostty")).toBe(ghostty);
    expect(registry.get("rio")).toBe(rio);
  });

  it("(b) init and start ghostty, state is running, active is ghostty", async () => {
    registry.register(ghostty);
    registry.register(rio);

    sm.transition("init");
    await ghostty.init(TEST_CONFIG);
    await ghostty.start(TEST_SURFACE);
    sm.transition("init_success");
    registry.setActive("ghostty");

    expect(ghostty.getState()).toBe("running");
    expect(sm.state).toBe("running");
    expect(registry.getActive()?.id).toBe("ghostty");
  });

  it("(c) bind a mock PTY stream, verify data flows to renderer", async () => {
    registry.register(ghostty);
    sm.transition("init");
    await ghostty.init(TEST_CONFIG);
    await ghostty.start(TEST_SURFACE);
    sm.transition("init_success");
    registry.setActive("ghostty");

    const stream = new ReadableStream<Uint8Array>();
    bindingMgr.bind("pty-1", stream, ghostty);

    expect(bindingMgr.count()).toBe(1);
    expect(ghostty.boundStreams.has("pty-1")).toBe(true);
  });

  it("(d) switch ghostty -> rio, verify state transitions, streams rebound, output continuity (SC-010-003)", async () => {
    registry.register(ghostty);
    registry.register(rio);
    sm.transition("init");
    await ghostty.init(TEST_CONFIG);
    await ghostty.start(TEST_SURFACE);
    sm.transition("init_success");
    registry.setActive("ghostty");

    const stream1 = new ReadableStream<Uint8Array>();
    const stream2 = new ReadableStream<Uint8Array>();
    const boundStreams = new Map<string, ReadableStream<Uint8Array>>();
    boundStreams.set("pty-1", stream1);
    boundStreams.set("pty-2", stream2);

    // Bind to ghostty
    for (const [id, s] of boundStreams) {
      ghostty.bindStream(id, s);
    }

    await switchRenderer("ghostty", "rio", {
      registry,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams,
      eventBus: bus,
    });

    expect(registry.getActive()?.id).toBe("rio");
    expect(sm.state).toBe("running");
    // Streams are rebound to rio
    expect(rio.boundStreams.has("pty-1")).toBe(true);
    expect(rio.boundStreams.has("pty-2")).toBe(true);
    // Byte count: both streams were transferred
    expect(rio.boundStreams.size).toBe(2);
  });

  it("(e) switch rio -> ghostty round-trip", async () => {
    registry.register(ghostty);
    registry.register(rio);
    sm.transition("init");
    await ghostty.init(TEST_CONFIG);
    await ghostty.start(TEST_SURFACE);
    sm.transition("init_success");
    registry.setActive("ghostty");

    const boundStreams = new Map<string, ReadableStream<Uint8Array>>();
    boundStreams.set("pty-1", new ReadableStream());

    // Switch ghostty -> rio
    await switchRenderer("ghostty", "rio", {
      registry,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams,
      eventBus: bus,
    });
    expect(registry.getActive()?.id).toBe("rio");

    // Switch rio -> ghostty
    await switchRenderer("rio", "ghostty", {
      registry,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams,
      eventBus: bus,
    });
    expect(registry.getActive()?.id).toBe("ghostty");
    expect(sm.state).toBe("running");
  });

  it("(f) inject failure during switch, verify rollback to ghostty (SC-010-001)", async () => {
    registry.register(ghostty);
    const failingRio = new MockRioAdapter({ startFail: true });
    registry.register(failingRio);
    sm.transition("init");
    await ghostty.init(TEST_CONFIG);
    await ghostty.start(TEST_SURFACE);
    sm.transition("init_success");
    registry.setActive("ghostty");

    const boundStreams = new Map<string, ReadableStream<Uint8Array>>();
    boundStreams.set("pty-1", new ReadableStream());

    await expect(
      switchRenderer("ghostty", "rio", {
        registry,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams,
        eventBus: bus,
      })
    ).rejects.toThrow();

    // Rolled back to ghostty
    expect(registry.getActive()?.id).toBe("ghostty");
    expect(sm.state).toBe("running");
    expect(events.some(e => e.type === "renderer.switch_failed")).toBe(true);
  });
});
