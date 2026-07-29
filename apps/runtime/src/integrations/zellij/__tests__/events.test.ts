import { describe, expect, it, mock } from "bun:test";
import {
  MuxEventEmitter,
  MuxEventType,
  generateCorrelationId,
  type EventBus,
  type MuxEvent,
  type SessionCreatedEvent,
  type PaneAddedEvent,
  type TabSwitchedEvent,
  type PaneDimensionRejectedEvent,
} from "../events.js";

function makeBus(): EventBus & { events: MuxEvent[] } {
  const events: MuxEvent[] = [];
  return {
    events,
    publish: mock(async (event: MuxEvent) => {
      events.push(event);
    }),
  };
}

describe("MuxEventType constants", () => {
  it("defines all expected event types", () => {
    expect(MuxEventType.SESSION_CREATED).toBe("mux.session.created");
    expect(MuxEventType.SESSION_REATTACHED).toBe("mux.session.reattached");
    expect(MuxEventType.SESSION_TERMINATED).toBe("mux.session.terminated");
    expect(MuxEventType.PANE_ADDED).toBe("mux.pane.added");
    expect(MuxEventType.PANE_CLOSED).toBe("mux.pane.closed");
    expect(MuxEventType.PANE_RESIZED).toBe("mux.pane.resized");
    expect(MuxEventType.PANE_PTY_BOUND).toBe("mux.pane.pty_bound");
    expect(MuxEventType.PANE_DIMENSION_REJECTED).toBe("mux.pane.dimension_rejected");
    expect(MuxEventType.TAB_CREATED).toBe("mux.tab.created");
    expect(MuxEventType.TAB_CLOSED).toBe("mux.tab.closed");
    expect(MuxEventType.TAB_SWITCHED).toBe("mux.tab.switched");
  });
});

describe("generateCorrelationId", () => {
  it("returns unique IDs", () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^mux-/);
  });
});

describe("MuxEventEmitter", () => {
  it("publishes events to the bus", () => {
    const bus = makeBus();
    const emitter = new MuxEventEmitter(bus);

    const event: SessionCreatedEvent = {
      type: MuxEventType.SESSION_CREATED,
      sessionName: "helios-lane-test",
      laneId: "test",
      timestamp: Date.now(),
      correlationId: "cid-1",
    };

    emitter.emit(event);
    // Fire-and-forget - wait a tick for the promise to resolve
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it("emitTyped populates timestamp and correlationId", async () => {
    const bus = makeBus();
    const emitter = new MuxEventEmitter(bus);

    emitter.emitTyped<PaneAddedEvent>({
      type: MuxEventType.PANE_ADDED,
      sessionName: "s1",
      laneId: "l1",
      paneId: 42,
      dimensions: { cols: 80, rows: 24 },
    });

    // Wait for async publish
    await new Promise(r => setTimeout(r, 10));
    expect(bus.events).toHaveLength(1);
    const evt = bus.events[0]!;
    expect(evt.timestamp).toBeGreaterThan(0);
    expect(evt.correlationId).toMatch(/^mux-/);
  });

  it("allows custom correlationId", async () => {
    const bus = makeBus();
    const emitter = new MuxEventEmitter(bus);

    emitter.emitTyped<TabSwitchedEvent>({
      type: MuxEventType.TAB_SWITCHED,
      sessionName: "s1",
      laneId: "l1",
      fromTabId: 0,
      toTabId: 1,
      correlationId: "custom-123",
    });

    await new Promise(r => setTimeout(r, 10));
    expect(bus.events[0]!.correlationId).toBe("custom-123");
  });

  it("emits pane.dimension_rejected events", async () => {
    const bus = makeBus();
    const emitter = new MuxEventEmitter(bus);

    emitter.emitTyped<PaneDimensionRejectedEvent>({
      type: MuxEventType.PANE_DIMENSION_REJECTED,
      sessionName: "s1",
      laneId: "l1",
      paneId: 5,
      requestedDimensions: { cols: 5, rows: 2 },
      minDimensions: { cols: 10, rows: 3 },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(bus.events[0]!.type).toBe("mux.pane.dimension_rejected");
  });

  it("swallows bus publish failures without throwing", async () => {
    const failingBus: EventBus = {
      publish: mock(async () => {
        throw new Error("bus down");
      }),
    };
    const emitter = new MuxEventEmitter(failingBus);

    // Should not throw
    emitter.emit({
      type: MuxEventType.SESSION_TERMINATED,
      sessionName: "s",
      laneId: "l",
      timestamp: Date.now(),
      correlationId: "c",
    });

    // Wait for the catch path
    await new Promise(r => setTimeout(r, 20));
    expect(failingBus.publish).toHaveBeenCalledTimes(1);
  });

  it("isolates bus failure from subsequent emits", async () => {
    let callCount = 0;
    const bus: EventBus = {
      publish: mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("transient");
      }),
    };
    const emitter = new MuxEventEmitter(bus);

    emitter.emit({
      type: MuxEventType.PANE_CLOSED,
      sessionName: "s",
      laneId: "l",
      timestamp: 1,
      correlationId: "c1",
      paneId: 1,
    } as MuxEvent);

    emitter.emit({
      type: MuxEventType.PANE_CLOSED,
      sessionName: "s",
      laneId: "l",
      timestamp: 2,
      correlationId: "c2",
      paneId: 2,
    } as MuxEvent);

    await new Promise(r => setTimeout(r, 20));
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });
});
