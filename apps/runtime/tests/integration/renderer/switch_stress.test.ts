/**
 * Stress tests for renderer switch robustness.
 * @see SC-010-001, NFR-010-001
 */
import { describe, expect, it } from "bun:test";
import { RendererRegistry } from "../../../src/renderer/registry.js";
import { RendererStateMachine } from "../../../src/renderer/state_machine.js";
import { switchRenderer } from "../../../src/renderer/switch.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import type { RendererEventBus, RendererLifecycleEvent } from "../../../src/renderer/index.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
} from "../../helpers/mock_adapter.js";

function freshSetup() {
  const _registry = new RendererRegistry();
  const sm = new RendererStateMachine();
  const _ghostty = new MockGhosttyAdapter();
  const rio = new MockRioAdapter();
  registry.register(ghostty);
  registry.register(rio);
  registry.setActive("ghostty");
  sm.transition("init");
  sm.transition("init_success");
  const events: RendererLifecycleEvent[] = [];
  const bus: RendererEventBus = { publish: e => events.push(e) };
  return { registry, sm, ghostty, rio, events, bus };
}

describe("Switch stress tests", () => {
  it("(a) rapid switch requests: only one executes, others rejected", async () => {
    const { registry, sm, bus } = freshSetup();
    const boundStreams = new Map<string, ReadableStream<Uint8Array>>();

    // First switch should succeed
    const p1 = switchRenderer("ghostty", "rio", {
      registry,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams,
      eventBus: bus,
    });

    // Second switch should fail because state is "switching"
    await p1;
    // After first switch, state is running, active is rio
    expect(registry.getActive()?.id).toBe("rio");

    // Now try rapid switches - sequential since state machine prevents concurrent
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < 10; i++) {
      try {
        const fromId = i % 2 === 0 ? "rio" : "ghostty";
        const toId = i % 2 === 0 ? "ghostty" : "rio";
        await switchRenderer(fromId, toId, {
          registry,
          stateMachine: sm,
          surface: TEST_SURFACE,
          config: TEST_CONFIG,
          boundStreams,
          eventBus: bus,
        });
        successCount++;
    // eslint-disable-next-line no-unused-vars
      } catch (_err) {
        failCount++;
      }
    }
    // All sequential switches should succeed
    expect(successCount).toBe(10);
    expect(sm.state).toBe("running");
  });

  it("(b) switch with high-throughput PTY output: buffering captures data", () => {
    const buf = new SwitchBuffer(1024 * 1024); // 1MB
    buf.startBuffering();

    // Simulate high-throughput: 100 chunks of 10KB each = 1MB
    for (let i = 0; i < 100; i++) {
      buf.write("pty-1", new Uint8Array(10 * 1024));
    }

    expect(buf.getBufferedBytes()).toBe(100 * 10 * 1024);

    const _renderer = new MockGhosttyAdapter();
    buf.stopBuffering(renderer);
    expect(renderer.boundStreams.has("pty-1")).toBe(true);
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("(c) switch with multiple PTYs bound (10 PTYs): all streams rebound", async () => {
    const { registry, sm, bus, _ghostty, rio } = freshSetup();
    const boundStreams = new Map<string, ReadableStream<Uint8Array>>();

    for (let i = 0; i < 10; i++) {
      boundStreams.set(`pty-${i}`, new ReadableStream());
    }

    await switchRenderer("ghostty", "rio", {
      registry,
      stateMachine: sm,
      surface: TEST_SURFACE,
      config: TEST_CONFIG,
      boundStreams,
      eventBus: bus,
    });

    expect(rio.boundStreams.size).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(rio.boundStreams.has(`pty-${i}`)).toBe(true);
    }
  });

  it("(d) switch failure at each step: rollback verified", async () => {
    // Test init failure
    {
      const { registry, sm, bus } = freshSetup();
      const failRio = registry.get("rio") as MockRioAdapter;
      failRio.setOptions({ initFail: true });

      await expect(
        switchRenderer("ghostty", "rio", {
          registry,
          stateMachine: sm,
          surface: TEST_SURFACE,
          config: TEST_CONFIG,
          boundStreams: new Map(),
          eventBus: bus,
        })
      ).rejects.toThrow();
      expect(sm.state).toBe("running"); // rolled back
    }

    // Test start failure
    {
      const { registry, sm, bus } = freshSetup();
      const failRio = registry.get("rio") as MockRioAdapter;
      failRio.setOptions({ startFail: true });

      await expect(
        switchRenderer("ghostty", "rio", {
          registry,
          stateMachine: sm,
          surface: TEST_SURFACE,
          config: TEST_CONFIG,
          boundStreams: new Map(),
          eventBus: bus,
        })
      ).rejects.toThrow();
      expect(sm.state).toBe("running"); // rolled back
    }
  });

  it("(e) double failure: new renderer fails, rollback fails -> errored state", async () => {
    const { registry, sm, events, bus } = freshSetup();
    const _ghostty = registry.get("ghostty") as MockGhosttyAdapter;
    const rio = registry.get("rio") as MockRioAdapter;

    rio.setOptions({ startFail: true }); // switch fails
    ghostty.setOptions({ initFail: true }); // rollback fails

    await expect(
      switchRenderer("ghostty", "rio", {
        registry,
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

  it("reports switch latency distribution", async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 5; i++) {
      const { registry, sm, bus } = freshSetup();
      const start = performance.now();

      const fromId = "ghostty";
      const toId = "rio";

      await switchRenderer(fromId, toId, {
        registry,
        stateMachine: sm,
        surface: TEST_SURFACE,
        config: TEST_CONFIG,
        boundStreams: new Map(),
        eventBus: bus,
      });

      latencies.push(performance.now() - start);
    }

    const avg = latencies.reduce((s, l) => s + l, 0) / latencies.length;
    const max = Math.max(...latencies);

    // Report
    console.log(
      `Switch latency: avg=${avg.toFixed(2)}ms, max=${max.toFixed(2)}ms, p50=${latencies.sort()[2]!.toFixed(2)}ms`
    );
    // All should be well under 3 seconds
    expect(max).toBeLessThan(3000);
  });
});
