import { describe, expect, it } from "bun:test";
import { RingBuffer, OutputBuffer } from "../../../src/pty/buffers.js";
import { InMemoryBusPublisher } from "../../../src/pty/events.js";
import type { PtyEventCorrelation } from "../../../src/pty/events.js";

// Traces to: FR-PTY-005 (bounded output buffers with backpressure), FR-PTY-006 (publish PTY lifecycle events)

function makeCorrelation(): PtyEventCorrelation {
  return {
    ptyId: "pty-buf-1",
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    correlationId: "corr-1",
  };
}

// ── RingBuffer ───────────────────────────────────────────────────────────────

describe("RingBuffer", () => {
  it("creates with given capacity", () => {
    const rb = new RingBuffer(1024);
    expect(rb.capacity).toBe(1024);
    expect(rb.available).toBe(0);
    expect(rb.utilization).toBe(0);
  });

  it("rejects non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
    expect(() => new RingBuffer(1.5)).toThrow();
  });

  it("write and consume round-trip", () => {
    const rb = new RingBuffer(64);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result = rb.write(data);
    expect(result.written).toBe(5);
    expect(result.dropped).toBe(0);
    expect(rb.available).toBe(5);

    const out = rb.consume();
    expect(out).toEqual(data);
    expect(rb.available).toBe(0);
  });

  it("drops data when full", () => {
    const rb = new RingBuffer(4);
    const result = rb.write(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(result.written).toBe(4);
    expect(result.dropped).toBe(2);
    expect(rb.available).toBe(4);
  });

  it("wraps around correctly", () => {
    const rb = new RingBuffer(8);
    rb.write(new Uint8Array([1, 2, 3, 4, 5, 6]));
    rb.consume(4); // consume [1,2,3,4], head moves to 4
    rb.write(new Uint8Array([7, 8, 9, 10])); // wraps around
    expect(rb.available).toBe(6);
    const out = rb.consume();
    expect(out).toEqual(new Uint8Array([5, 6, 7, 8, 9, 10]));
  });

  it("peek does not advance head", () => {
    const rb = new RingBuffer(16);
    rb.write(new Uint8Array([10, 20, 30]));
    const peeked = rb.peek(2);
    expect(peeked).toEqual(new Uint8Array([10, 20]));
    expect(rb.available).toBe(3);
  });

  it("partial consume", () => {
    const rb = new RingBuffer(16);
    rb.write(new Uint8Array([1, 2, 3, 4]));
    const part = rb.consume(2);
    expect(part).toEqual(new Uint8Array([1, 2]));
    expect(rb.available).toBe(2);
  });

  it("clear resets buffer", () => {
    const rb = new RingBuffer(16);
    rb.write(new Uint8Array([1, 2, 3]));
    rb.clear();
    expect(rb.available).toBe(0);
    expect(rb.utilization).toBe(0);
  });

  it("utilization calculation", () => {
    const rb = new RingBuffer(100);
    rb.write(new Uint8Array(75));
    expect(rb.utilization).toBe(0.75);
  });

  it("write returns {written:0, dropped:N} when completely full", () => {
    const rb = new RingBuffer(4);
    rb.write(new Uint8Array([1, 2, 3, 4]));
    const r = rb.write(new Uint8Array([5, 6]));
    expect(r.written).toBe(0);
    expect(r.dropped).toBe(2);
  });
});

// ── OutputBuffer ─────────────────────────────────────────────────────────────

describe("OutputBuffer", () => {
  it("writes data and tracks stats", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), {
      capacityBytes: 1024,
    });

    ob.write(new Uint8Array(100));
    const stats = ob.getStats();
    expect(stats.totalWritten).toBe(100);
    expect(stats.totalDropped).toBe(0);
    expect(stats.capacity).toBe(1024);
  });

  it("consume returns written data", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), { capacityBytes: 64 });
    const data = new Uint8Array([1, 2, 3]);
    ob.write(data);
    expect(ob.consume()).toEqual(data);
  });

  // ── Backpressure ─────────────────────────────────────────────────

  it("emits backpressure.on when crossing threshold", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), {
      capacityBytes: 100,
      backpressureThreshold: 0.75,
    });

    ob.write(new Uint8Array(75));
    expect(ob.isBackpressured).toBe(true);

    const onEvents = bus.events.filter(e => e.topic === "pty.backpressure.on");
    expect(onEvents).toHaveLength(1);
    expect(onEvents[0]!.payload["utilization"]).toBe(0.75);
  });

  it("does not re-emit backpressure.on while already active", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), {
      capacityBytes: 100,
      backpressureThreshold: 0.75,
    });

    ob.write(new Uint8Array(80));
    ob.write(new Uint8Array(5));
    const onEvents = bus.events.filter(e => e.topic === "pty.backpressure.on");
    expect(onEvents).toHaveLength(1);
  });

  it("emits backpressure.off with hysteresis band", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), {
      capacityBytes: 100,
      backpressureThreshold: 0.75,
      hysteresisBand: 0.1,
    });

    ob.write(new Uint8Array(80));
    expect(ob.isBackpressured).toBe(true);

    // Consume to 70% — still above hysteresis low (0.65)
    ob.consume(10);
    expect(ob.isBackpressured).toBe(true);

    // Consume to 60% — below hysteresis low (0.65)
    ob.consume(10);
    expect(ob.isBackpressured).toBe(false);

    const offEvents = bus.events.filter(e => e.topic === "pty.backpressure.off");
    expect(offEvents).toHaveLength(1);
  });

  it("includes ptyId and laneId in backpressure events", () => {
    const bus = new InMemoryBusPublisher();
    const corr = makeCorrelation();
    const ob = new OutputBuffer(bus, corr, {
      capacityBytes: 100,
      backpressureThreshold: 0.75,
    });

    ob.write(new Uint8Array(80));
    const evt = bus.events.find(e => e.topic === "pty.backpressure.on");
    expect(evt?.payload["ptyId"]).toBe(corr.ptyId);
    expect(evt?.payload["laneId"]).toBe(corr.laneId);
  });

  // ── Overflow telemetry ───────────────────────────────────────────

  it("emits overflow event and logs warning on first overflow", () => {
    const bus = new InMemoryBusPublisher();
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warns.push(msg);

    try {
      const ob = new OutputBuffer(bus, makeCorrelation(), {
        capacityBytes: 10,
        overflowDebounceMs: 0, // disable debounce for test
      });

      ob.write(new Uint8Array(15));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("overflow");

      const overflowEvts = bus.events.filter(e => e.topic === "pty.buffer.overflow");
      expect(overflowEvts).toHaveLength(1);
      expect(overflowEvts[0]!.payload["droppedBytes"]).toBe(5);

      const stats = ob.getStats();
      expect(stats.totalDropped).toBe(5);
      expect(stats.overflowEvents).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it("debounces overflow events (max 1/sec)", () => {
    const bus = new InMemoryBusPublisher();
    const origWarn = console.warn;
    console.warn = () => undefined;

    try {
      const ob = new OutputBuffer(bus, makeCorrelation(), {
        capacityBytes: 10,
        overflowDebounceMs: 5000,
      });

      // First write overflows — event emitted.
      ob.write(new Uint8Array(15));
      // Second overflow within debounce window — no event.
      ob.consume(10);
      ob.write(new Uint8Array(15));

      const overflowEvts = bus.events.filter(e => e.topic === "pty.buffer.overflow");
      expect(overflowEvts).toHaveLength(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it("tracks cumulative stats across multiple writes", () => {
    const bus = new InMemoryBusPublisher();
    const origWarn = console.warn;
    console.warn = () => undefined;

    try {
      const ob = new OutputBuffer(bus, makeCorrelation(), {
        capacityBytes: 10,
      });
      ob.write(new Uint8Array(8));
      ob.write(new Uint8Array(5)); // 3 dropped
      ob.consume(10);
      ob.write(new Uint8Array(10));

      const stats = ob.getStats();
      expect(stats.totalWritten).toBe(8 + 2 + 10);
      expect(stats.totalDropped).toBe(3);
    } finally {
      console.warn = origWarn;
    }
  });

  it("clear releases backpressure", () => {
    const bus = new InMemoryBusPublisher();
    const ob = new OutputBuffer(bus, makeCorrelation(), {
      capacityBytes: 100,
      backpressureThreshold: 0.75,
    });

    ob.write(new Uint8Array(80));
    expect(ob.isBackpressured).toBe(true);

    ob.clear();
    expect(ob.isBackpressured).toBe(false);
    expect(ob.available).toBe(0);

    const offEvents = bus.events.filter(e => e.topic === "pty.backpressure.off");
    expect(offEvents).toHaveLength(1);
  });
});
