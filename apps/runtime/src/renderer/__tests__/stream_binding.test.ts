/**
 * Unit tests for StreamBindingManager and SwitchBuffer.
 *
 * @see FR-010-005, NFR-010-002
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { StreamBindingManager, SwitchBuffer } from "../stream_binding.js";
import type { StreamBindingEventBus, BufferOverflowEvent } from "../stream_binding.js";
import type { RendererAdapter, RendererState } from "../adapter.js";
import type { RendererCapabilities } from "../capabilities.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function createMockAdapter(id: string): RendererAdapter & {
  boundStreams: Map<string, ReadableStream<Uint8Array>>;
  unboundPtys: string[];
} {
  const boundStreams = new Map<string, ReadableStream<Uint8Array>>();
  const unboundPtys: string[] = [];
  return {
    id,
    version: "1.0.0",
    init: async () => {},
    start: async () => {},
    stop: async () => {},
    bindStream: (ptyId: string, stream: ReadableStream<Uint8Array>) => {
      boundStreams.set(ptyId, stream);
    },
    unbindStream: (ptyId: string) => {
      boundStreams.delete(ptyId);
      unboundPtys.push(ptyId);
    },
    handleInput: () => {},
    resize: () => {},
    queryCapabilities: () => DEFAULT_CAPS,
    getState: (): RendererState => "running",
    onCrash: () => {},
    boundStreams,
    unboundPtys,
  };
}

function openStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start() {} });
}

// ---------------------------------------------------------------------------
// StreamBindingManager tests
// ---------------------------------------------------------------------------

describe("StreamBindingManager", () => {
  let mgr: StreamBindingManager;

  beforeEach(() => {
    mgr = new StreamBindingManager();
  });

  it("starts with zero bindings", () => {
    expect(mgr.count()).toBe(0);
    expect(mgr.getBindings().size).toBe(0);
  });

  // FR-010-005: bind connects stream to renderer
  it("bind connects stream to renderer", () => {
    const adapter = createMockAdapter("ghostty");
    const stream = openStream();

    mgr.bind("pty-1", stream, adapter);

    expect(mgr.count()).toBe(1);
    expect(adapter.boundStreams.has("pty-1")).toBe(true);
    const binding = mgr.getBindings().get("pty-1");
    expect(binding).toBeDefined();
    expect(binding!.ptyId).toBe("pty-1");
    expect(binding!.renderer).toBe(adapter);
  });

  it("measures relay latency on bind", () => {
    const adapter = createMockAdapter("ghostty");
    mgr.bind("pty-1", openStream(), adapter);
    const latency = mgr.getRelayLatency("pty-1");
    expect(latency).toBeDefined();
    expect(typeof latency).toBe("number");
    expect(latency!).toBeGreaterThanOrEqual(0);
  });

  // Edge case: bind already bound PTY replaces existing binding
  it("replaces existing binding for same ptyId", () => {
    const adapter1 = createMockAdapter("ghostty");
    const adapter2 = createMockAdapter("rio");

    mgr.bind("pty-1", openStream(), adapter1);
    mgr.bind("pty-1", openStream(), adapter2);

    expect(mgr.count()).toBe(1);
    expect(mgr.getBindings().get("pty-1")!.renderer).toBe(adapter2);
    // Old adapter should have been unbound
    expect(adapter1.unboundPtys).toContain("pty-1");
  });

  // FR-010-005: unbind disconnects without closing stream
  it("unbind disconnects without closing stream", () => {
    const adapter = createMockAdapter("ghostty");
    const stream = openStream();

    mgr.bind("pty-1", stream, adapter);
    mgr.unbind("pty-1");

    expect(mgr.count()).toBe(0);
    expect(adapter.unboundPtys).toContain("pty-1");
    // Stream should still be usable (not cancelled)
    expect(stream.locked).toBe(false);
  });

  // Edge case: unbind non-existent PTY is no-op
  it("unbind non-existent PTY is no-op", () => {
    mgr.unbind("non-existent"); // should not throw
    expect(mgr.count()).toBe(0);
  });

  // FR-010-005: rebindAll transfers all bindings
  it("rebindAll transfers all bindings to new renderer", () => {
    const oldAdapter = createMockAdapter("ghostty");
    const newAdapter = createMockAdapter("rio");

    mgr.bind("pty-1", openStream(), oldAdapter);
    mgr.bind("pty-2", openStream(), oldAdapter);
    expect(mgr.count()).toBe(2);

    mgr.rebindAll(newAdapter);

    expect(mgr.count()).toBe(2);
    // Old adapter should have been unbound
    expect(oldAdapter.unboundPtys).toContain("pty-1");
    expect(oldAdapter.unboundPtys).toContain("pty-2");
    // New adapter should have bindings
    expect(newAdapter.boundStreams.has("pty-1")).toBe(true);
    expect(newAdapter.boundStreams.has("pty-2")).toBe(true);
    // Binding records should reference new renderer
    for (const [, binding] of mgr.getBindings()) {
      expect(binding.renderer).toBe(newAdapter);
    }
  });

  // Edge case: rebindAll with zero bindings is no-op
  it("rebindAll with zero bindings is no-op", () => {
    const adapter = createMockAdapter("rio");
    mgr.rebindAll(adapter); // should not throw
    expect(mgr.count()).toBe(0);
    expect(adapter.boundStreams.size).toBe(0);
  });

  it("getBindings returns a copy", () => {
    const adapter = createMockAdapter("ghostty");
    mgr.bind("pty-1", openStream(), adapter);
    const bindings = mgr.getBindings();
    bindings.delete("pty-1");
    expect(mgr.count()).toBe(1); // original unchanged
  });

  it("getRelayLatency returns undefined for unbound PTY", () => {
    expect(mgr.getRelayLatency("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SwitchBuffer tests
// ---------------------------------------------------------------------------

describe("SwitchBuffer", () => {
  it("starts not buffering", () => {
    const buf = new SwitchBuffer();
    expect(buf.isBuffering).toBe(false);
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("captures data during buffering", () => {
    const buf = new SwitchBuffer();
    buf.startBuffering();
    expect(buf.isBuffering).toBe(true);

    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    buf.write("pty-1", new Uint8Array([4, 5]));
    expect(buf.getBufferedBytes()).toBe(5);
  });

  it("ignores writes when not buffering", () => {
    const buf = new SwitchBuffer();
    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("flushes buffered data to renderer on stopBuffering", () => {
    const buf = new SwitchBuffer();
    const adapter = createMockAdapter("rio");

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array([1, 2, 3]));
    buf.write("pty-2", new Uint8Array([4, 5]));

    buf.stopBuffering(adapter);

    expect(buf.isBuffering).toBe(false);
    expect(buf.getBufferedBytes()).toBe(0);
    // Adapter should have received bind calls for flushed data
    expect(adapter.boundStreams.has("pty-1")).toBe(true);
    expect(adapter.boundStreams.has("pty-2")).toBe(true);
  });

  // Edge case: switch completes instantly (no buffered data)
  it("stopBuffering with no data is a no-op flush", () => {
    const buf = new SwitchBuffer();
    const adapter = createMockAdapter("rio");

    buf.startBuffering();
    buf.stopBuffering(adapter);

    expect(buf.isBuffering).toBe(false);
    expect(adapter.boundStreams.size).toBe(0);
  });

  it("stopBuffering when not buffering is a no-op", () => {
    const buf = new SwitchBuffer();
    const adapter = createMockAdapter("rio");
    buf.stopBuffering(adapter); // should not throw
    expect(adapter.boundStreams.size).toBe(0);
  });

  // Buffer capacity enforcement
  it("drops oldest data when buffer exceeds capacity", () => {
    const maxBytes = 10;
    const events: BufferOverflowEvent[] = [];
    const eventBus: StreamBindingEventBus = { publish: e => events.push(e) };
    const buf = new SwitchBuffer(maxBytes, eventBus);

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(6)); // 6 bytes
    buf.write("pty-1", new Uint8Array(6)); // 12 > 10, should drop oldest

    expect(buf.getBufferedBytes()).toBeLessThanOrEqual(maxBytes);
    expect(buf.getDroppedBytes("pty-1")).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.type).toBe("renderer.switch.buffer_overflow");
    expect(events[0]!.ptyId).toBe("pty-1");
  });

  // Edge case: multiple PTYs have independent buffers
  it("buffers independently per PTY", () => {
    const buf = new SwitchBuffer();

    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(100));
    buf.write("pty-2", new Uint8Array(200));

    expect(buf.getBufferedBytes()).toBe(300);
  });

  it("clears buffers on startBuffering", () => {
    const buf = new SwitchBuffer();
    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(10));
    buf.startBuffering(); // should clear
    expect(buf.getBufferedBytes()).toBe(0);
  });

  it("handles single chunk exceeding capacity", () => {
    const maxBytes = 10;
    const buf = new SwitchBuffer(maxBytes);
    buf.startBuffering();
    buf.write("pty-1", new Uint8Array(20)); // exceeds max
    expect(buf.getBufferedBytes()).toBeLessThanOrEqual(maxBytes);
    expect(buf.getDroppedBytes("pty-1")).toBeGreaterThan(0);
  });
});
