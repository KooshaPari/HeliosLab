import { describe, expect, it } from "bun:test";
import { emitPtyEvent, InMemoryBusPublisher, NoOpBusPublisher } from "../events.js";
import type { PtyEventCorrelation, BusPublisher, PtyBusEvent } from "../events.js";

describe("emitPtyEvent", () => {
  const correlation: PtyEventCorrelation = {
    ptyId: "pty-1",
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    correlationId: "corr-1",
  };

  it("publishes event with correct structure", () => {
    const bus = new InMemoryBusPublisher();
    emitPtyEvent(bus, "pty.spawned", correlation, { pid: 123 });

    expect(bus.events).toHaveLength(1);
    const evt = bus.events[0]!;
    expect(evt.type).toBe("event");
    expect(evt.topic).toBe("pty.spawned");
    expect(evt.session_id).toBe("session-1");
    expect(evt.terminal_id).toBe("term-1");
    expect(evt.payload["ptyId"]).toBe("pty-1");
    expect(evt.payload["correlationId"]).toBe("corr-1");
    expect(evt.payload["pid"]).toBe(123);
    expect(evt.id).toBeDefined();
    expect(evt.ts).toBeDefined();
  });

  it("does not throw when bus fails", () => {
    const failingBus: BusPublisher = {
      publish(_event: PtyBusEvent): void {
        throw new Error("Bus down");
      },
    };

    // Should not throw.
    emitPtyEvent(failingBus, "pty.error", correlation);
  });

  it("NoOpBusPublisher silently drops events", () => {
    const bus = new NoOpBusPublisher();
    // Should not throw.
    emitPtyEvent(bus, "pty.spawned", correlation);
  });
});

describe("InMemoryBusPublisher", () => {
  it("records and clears events", () => {
    const bus = new InMemoryBusPublisher();
    emitPtyEvent(bus, "pty.spawned", {
      ptyId: "p1",
      laneId: "l1",
      sessionId: "s1",
      terminalId: "t1",
      correlationId: "c1",
    });

    expect(bus.events).toHaveLength(1);
    bus.clear();
    expect(bus.events).toHaveLength(0);
  });
});
