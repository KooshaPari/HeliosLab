/**
 * FR-HELIOS-058: Stream Binding Manager Tests
 * Verifies: FR-RND-005 (PTY stream binding/unbinding), FR-TXN-005 (Preserve PTY streams during switch)
 */
import { describe, expect, it, afterEach } from "bun:test";
import { StreamBindingManager, SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import type { BufferOverflowEvent } from "../../../src/renderer/stream_binding.js";
import { MockGhosttyAdapter, MockRioAdapter } from "../../helpers/mock_adapter.js";

// Track all created streams for cleanup to prevent test hanging
const createdStreams: ReadableStream<Uint8Array>[] = [];
const createdRenderers: (MockGhosttyAdapter | MockRioAdapter)[] = [];

afterEach(() => {
  // Cancel all unclosed streams created directly in tests
  for (const stream of createdStreams) {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
    stream.cancel().catch(() => {});
  }
  createdStreams.length = 0;

  // Cancel all streams bound to mock renderers
  for (const renderer of createdRenderers) {
    for (const stream of renderer.boundStreams.values()) {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
      stream.cancel().catch(() => {});
    }
  }
  createdRenderers.length = 0;
});

describe("StreamBindingManager", () => {
  it("binds a stream to a renderer", () => {
    const mgr = new StreamBindingManager();
    const renderer = new MockGhosttyAdapter();
    createdRenderers.push(renderer);
    const stream = new ReadableStream<Uint8Array>();
    createdStreams.push(stream);

    mgr.bind("pty-1", stream, renderer);

    expect(mgr.count()).toBe(1);
    expect(mgr.getBindings().get("pty-1")?.ptyId).toBe("pty-1");
    expect(renderer.boundStreams.has("pty-1")).toBe(true);
  });

  it("unbinds a stream without closing it", () => {
    const mgr = new StreamBindingManager();
    const renderer = new MockGhosttyAdapter();
    createdRenderers.push(renderer);
    const stream = new ReadableStream<Uint8Array>();
    createdStreams.push(stream);

    mgr.bind("pty-1", stream, renderer);
    mgr.unbind("pty-1");

    expect(mgr.count()).toBe(0);
    expect(renderer.unboundPtyIds).toContain("pty-1");
    // Stream is NOT closed - it's still a valid ReadableStream
  });

  it("unbind is no-op for unbound PTY", () => {
    const mgr = new StreamBindingManager();
    mgr.unbind("nonexistent"); // should not throw
    expect(mgr.count()).toBe(0);
  });

  it("replaces existing binding on duplicate bind", () => {
    const mgr = new StreamBindingManager();
    const renderer = new MockGhosttyAdapter();
    createdRenderers.push(renderer);
    const stream1 = new ReadableStream<Uint8Array>();
    const stream2 = new ReadableStream<Uint8Array>();
    createdStreams.push(stream1, stream2);

    mgr.bind("pty-1", stream1, renderer);
    mgr.bind("pty-1", stream2, renderer);

    expect(mgr.count()).toBe(1);
    const bindingMap = mgr.getBindings();
    expect(bindingMap.has("pty-1")).toBe(true);
    const _binding = bindingMap.get("pty-1")!;
    expect(_binding?.stream).toBe(stream2);
  });

  it("rebindAll transfers all bindings to new renderer", () => {
    const mgr = new StreamBindingManager();
    const oldRenderer = new MockGhosttyAdapter();
    const newRenderer = new MockRioAdapter();
    createdRenderers.push(oldRenderer, newRenderer);

    const stream1 = new ReadableStream();
    const stream2 = new ReadableStream();
    createdStreams.push(stream1, stream2);
    mgr.bind("pty-1", stream1, oldRenderer);
    mgr.bind("pty-2", stream2, oldRenderer);

    mgr.rebindAll(newRenderer);

    expect(mgr.count()).toBe(2);
    expect(newRenderer.boundStreams.has("pty-1")).toBe(true);
    expect(newRenderer.boundStreams.has("pty-2")).toBe(true);
    expect(oldRenderer.unboundPtyIds.sort()).toEqual(["pty-1", "pty-2"]);

    // All bindings now point to new renderer
    for (const [, binding] of mgr.getBindings()) {
      expect(binding.renderer).toBe(newRenderer);
    }
  });

  it("rebindAll is no-op with zero bindings", () => {
    const mgr = new StreamBindingManager();
    const newRenderer = new MockRioAdapter();
    createdRenderers.push(newRenderer);
    mgr.rebindAll(newRenderer); // should not throw
    expect(mgr.count()).toBe(0);
  });

  it("measures relay latency (NFR-010-002)", () => {
    const mgr = new StreamBindingManager();
    const renderer = new MockGhosttyAdapter();
    createdRenderers.push(renderer);
    const stream = new ReadableStream();
    createdStreams.push(stream);
    mgr.bind("pty-1", stream, renderer);

    const latency = mgr.getRelayLatency("pty-1");
    expect(latency).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: latency was just confirmed defined above
    expect(latency!).toBeLessThan(16.7); // < 1 frame
  });

  it("getBindings returns a copy", () => {
    const mgr = new StreamBindingManager();
    const renderer = new MockGhosttyAdapter();
    createdRenderers.push(renderer);
    const stream = new ReadableStream();
    createdStreams.push(stream);
    mgr.bind("pty-1", stream, renderer);

    const bindings = mgr.getBindings();
    bindings.delete("pty-1");
    expect(mgr.count()).toBe(1); // original unchanged
  });
});

describe("SwitchBuffer", () => {
  it("starts not buffering", () => {
    const buf = new SwitchBuffer();
    expect(buf.isBuffering).toBe(false);
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("captures data during buffering", () => {
    const buf = new SwitchBuffer();
    buf.startBuffering();

    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    buf.write("pty-1", new Uint8Array([4, 5]));

    expect(buf.isBuffering).toBe(true);
    expect(buf.getBufferedBytes()).toBe(5);
  });

  it("ignores writes when not buffering", () => {
    const buf = new SwitchBuffer();
    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("flushes buffered data to new renderer on stopBuffering", () => {
    const buf = new SwitchBuffer();
    const _renderer = new MockGhosttyAdapter();
    createdRenderers.push(_renderer);

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    buf.write("pty-2", new Uint8Array([4, 5]));
    buf.stopBuffering(renderer);

    expect(buf.isBuffering).toBe(false);
    expect(buf.getBufferedBytes()).toBe(0);
    expect(renderer.boundStreams.has("pty-1")).toBe(true);
    expect(renderer.boundStreams.has("pty-2")).toBe(true);
  });

  it("stopBuffering is no-op when not buffering", () => {
    const buf = new SwitchBuffer();
    const _renderer = new MockGhosttyAdapter();
    createdRenderers.push(_renderer);
    buf.stopBuffering(renderer); // should not throw
    expect(renderer.boundStreams.size).toBe(0);
  });

  it("instant switch with no buffered data: flush is no-op", () => {
    const buf = new SwitchBuffer();
    const _renderer = new MockGhosttyAdapter();
    createdRenderers.push(_renderer);
    buf.startBuffering();
    buf.stopBuffering(renderer);
    expect(renderer.boundStreams.size).toBe(0);
  });

  it("respects capacity limits and drops oldest data", () => {
    const events: BufferOverflowEvent[] = [];
    const bus = { publish: (e: BufferOverflowEvent) => events.push(e) };
    const buf = new SwitchBuffer(10, bus); // 10 byte limit

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(6));
    buf.write("pty-1", new Uint8Array(6)); // exceeds 10, should drop oldest

    expect(buf.getBufferedBytes()).toBeLessThanOrEqual(10);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.type).toBe("renderer.switch.buffer_overflow");
    expect(events[0]!.ptyId).toBe("pty-1");
  });

  it("buffers independently per PTY", () => {
    const buf = new SwitchBuffer();
    buf.startBuffering();

    buf.write("pty-1", new Uint8Array(100));
    buf.write("pty-2", new Uint8Array(200));

    expect(buf.getBufferedBytes()).toBe(300);
  });

  it("publishes overflow event when data is dropped", () => {
    const events: BufferOverflowEvent[] = [];
    const bus = { publish: (e: BufferOverflowEvent) => events.push(e) };
    const buf = new SwitchBuffer(5, bus);

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(3));
    buf.write("pty-1", new Uint8Array(4)); // total 7 > 5

    expect(events.some(e => e.droppedBytes > 0)).toBe(true);
  });
});
