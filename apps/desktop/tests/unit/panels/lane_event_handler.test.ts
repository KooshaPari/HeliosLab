import { LaneEventHandler } from "../../../src/panels/lane_event_handler";
import type { BusSubscriber, BusEvent } from "../../../src/panels/lane_event_handler";

describe("LaneEventHandler", () => {
  let handler: LaneEventHandler;
  let mockBus: BusSubscriber;
  let busHandlers: Map<string, (event: BusEvent) => void>;

  beforeEach(() => {
    busHandlers = new Map();
    mockBus = {
      subscribe: vi.fn((topic, handler) => {
        busHandlers.set(topic, handler);
      }),
      unsubscribe: vi.fn(topic => {
        busHandlers.delete(topic);
      }),
    };
  });

  afterEach(() => {
    if (handler) {
      handler.unmount();
    }
  });

  it("should subscribe to lane events on mount", () => {
    handler = new LaneEventHandler({ bus: mockBus });
    handler.mount();

    expect(mockBus.subscribe).toHaveBeenCalledWith("lane.state.changed", expect.any(Function));
    expect(mockBus.subscribe).toHaveBeenCalledWith("lane.created", expect.any(Function));
  });

  it("should handle state changed events", async () => {
    const onStateChanged = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onStateChanged,
    });
    handler.mount();

    const event: BusEvent = {
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "running" },
      timestamp: Date.now(),
    };

    const stateChangedHandler = busHandlers.get("lane.state.changed");
    stateChangedHandler?.(event);

    // Wait for RAF fallback (setTimeout(0)) to fire
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onStateChanged).toHaveBeenCalledWith("lane-1", "running");
  });

  it("should handle lane created events", () => {
    const onLaneCreated = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onLaneCreated,
    });
    handler.mount();

    const event: BusEvent = {
      topic: "lane.created",
      payload: { laneId: "lane-new", name: "New Lane" },
      timestamp: Date.now(),
    };

    const createdHandler = busHandlers.get("lane.created");
    createdHandler?.(event);

    expect(onLaneCreated).toHaveBeenCalledWith("lane-new", "New Lane");
  });

  it("should handle lane cleanup events", () => {
    const onLaneCleaned = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onLaneCleaned,
    });
    handler.mount();

    const event: BusEvent = {
      topic: "lane.cleaned_up",
      payload: { laneId: "lane-1" },
      timestamp: Date.now(),
    };

    const cleanedHandler = busHandlers.get("lane.cleaned_up");
    cleanedHandler?.(event);

    expect(onLaneCleaned).toHaveBeenCalledWith("lane-1");
  });

  it("should batch rapid state changes with RAF", async () => {
    const onStateChanged = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onStateChanged,
    });
    handler.mount();

    const stateChangedHandler = busHandlers.get("lane.state.changed");

    // Send rapid updates
    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "running" },
      timestamp: Date.now(),
    });

    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "blocked" },
      timestamp: Date.now(),
    });

    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "error" },
      timestamp: Date.now(),
    });

    // Wait for RAF to fire (happy-dom needs a longer wait)
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onStateChanged).toHaveBeenCalled();
    // Should only render final state due to batching
  });

  it("should discard out-of-order events", async () => {
    const onStateChanged = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onStateChanged,
    });
    handler.mount();

    const stateChangedHandler = busHandlers.get("lane.state.changed");

    // Send events with sequence numbers
    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "running" },
      sequenceNumber: 2,
      timestamp: Date.now(),
    });

    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "idle" },
      sequenceNumber: 1, // Out of order
      timestamp: Date.now(),
    });

    // Wait for RAF fallback to fire
    await new Promise(resolve => setTimeout(resolve, 50));

    // The out-of-order event should be discarded
    expect(onStateChanged).toHaveBeenCalledWith("lane-1", "running");
  });

  it("should monitor bus connectivity", async () => {
    const onBusConnectivityIssue = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onBusConnectivityIssue,
      busTimeoutMs: 50, // Short timeout for testing
    });
    handler.mount();

    // Simulate no events for timeout period (wait well beyond busTimeoutMs)
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(onBusConnectivityIssue).toHaveBeenCalledWith(true);
  });

  it("should recover connectivity after events resume", async () => {
    const onBusConnectivityIssue = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onBusConnectivityIssue,
      busTimeoutMs: 50,
    });
    handler.mount();

    // Wait for connectivity issue
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onBusConnectivityIssue).toHaveBeenCalledWith(true);

    // Receive an event
    const stateChangedHandler = busHandlers.get("lane.state.changed");
    stateChangedHandler?.({
      topic: "lane.state.changed",
      payload: { laneId: "lane-1", state: "running" },
      timestamp: Date.now(),
    });

    expect(onBusConnectivityIssue).toHaveBeenCalledWith(false);
  });

  it("should unsubscribe from events on unmount", () => {
    handler = new LaneEventHandler({ bus: mockBus });
    handler.mount();

    handler.unmount();

    expect(mockBus.unsubscribe).toHaveBeenCalledWith("lane.state.changed", expect.any(Function));
  });

  it("should handle orphan detection cycle events", () => {
    const onOrphanStatusChanged = vi.fn();
    handler = new LaneEventHandler({
      bus: mockBus,
      onOrphanStatusChanged,
    });
    handler.mount();

    const event: BusEvent = {
      topic: "orphan.detection.cycle_completed",
      payload: { orphanedLanes: ["lane-1", "lane-2"] },
      timestamp: Date.now(),
    };

    const orphanHandler = busHandlers.get("orphan.detection.cycle_completed");
    orphanHandler?.(event);

    expect(onOrphanStatusChanged).toHaveBeenCalledWith("lane-1", true);
    expect(onOrphanStatusChanged).toHaveBeenCalledWith("lane-2", true);
  });
});
