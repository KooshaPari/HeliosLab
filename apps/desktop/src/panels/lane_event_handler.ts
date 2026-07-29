/**
 * Lane Event Handler
 * Subscribes to bus events for real-time lane status updates
 */

export interface BusEvent {
  topic: string;
  payload: Record<string, any>;
  sequenceNumber?: number;
  timestamp: number;
}

export interface BusSubscriber {
  subscribe(topic: string, handler: (event: BusEvent) => void): void;
  unsubscribe(topic: string, handler: (event: BusEvent) => void): void;
}

export interface LaneEventHandlerOptions {
  bus: BusSubscriber;
  onStateChanged?: (laneId: string, newState: string) => void;
  onLaneCreated?: (laneId: string, name: string) => void;
  onLaneCleaned?: (laneId: string) => void;
  onOrphanStatusChanged?: (laneId: string, isOrphaned: boolean) => void;
  onBusConnectivityIssue?: (isIssue: boolean) => void;
  busTimeoutMs?: number;
}

export class LaneEventHandler {
  private options: LaneEventHandlerOptions;
  private subscriptions: Map<string, (event: BusEvent) => void> = new Map();
  private pendingUpdates: Map<string, BusEvent> = new Map();
  private lastEventTime: number = Date.now();
  private connectivityTimeoutId?: ReturnType<typeof setTimeout>;
  private rafId?: number | undefined;
  private lastSequenceNumbers: Map<string, number> = new Map();
  private isConnected: boolean = true;

  constructor(options: LaneEventHandlerOptions) {
    this.options = {
      busTimeoutMs: 30000,
      ...options,
    };
  }

  mount(): void {
    this.subscribeToEvents();
    this.startConnectivityMonitoring();
  }

  unmount(): void {
    this.unsubscribeFromEvents();
    this.stopConnectivityMonitoring();
    if (this.rafId) {
      (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout)(
        this.rafId as number
      );
    }
  }

  private subscribeToEvents(): void {
    const stateChangedHandler = (event: BusEvent) => {
      this.handleStateChanged(event);
    };

    const laneCreatedHandler = (event: BusEvent) => {
      this.handleLaneCreated(event);
    };

    const laneCleanedHandler = (event: BusEvent) => {
      this.handleLaneCleaned(event);
    };

    const orphanCycleHandler = (event: BusEvent) => {
      this.handleOrphanDetectionCycle(event);
    };

    this.subscriptions.set("lane.state.changed", stateChangedHandler);
    this.subscriptions.set("lane.created", laneCreatedHandler);
    this.subscriptions.set("lane.cleaned_up", laneCleanedHandler);
    this.subscriptions.set("orphan.detection.cycle_completed", orphanCycleHandler);

    this.options.bus.subscribe("lane.state.changed", stateChangedHandler);
    this.options.bus.subscribe("lane.created", laneCreatedHandler);
    this.options.bus.subscribe("lane.cleaned_up", laneCleanedHandler);
    this.options.bus.subscribe("orphan.detection.cycle_completed", orphanCycleHandler);
  }

  private unsubscribeFromEvents(): void {
    this.subscriptions.forEach((handler, topic) => {
      this.options.bus.unsubscribe(topic, handler);
    });
    this.subscriptions.clear();
  }

  private handleStateChanged(event: BusEvent): void {
    this.recordEventReceived();

    const laneId = event.payload.laneId;
    const newState = event.payload.state;

    if (!laneId || !newState) return;

    // Check sequence number to prevent out-of-order updates
    const lastSeq = this.lastSequenceNumbers.get(laneId) || -1;
    const eventSeq = event.sequenceNumber ?? 0;

    if (eventSeq < lastSeq) {
      // Discard out-of-order event
      return;
    }

    this.lastSequenceNumbers.set(laneId, eventSeq);

    // Batch updates with requestAnimationFrame
    this.pendingUpdates.set(laneId, event);
    this.scheduleRender();
  }

  private handleLaneCreated(event: BusEvent): void {
    this.recordEventReceived();

    const laneId = event.payload.laneId;
    const name = event.payload.name || "New Lane";

    if (!laneId) return;

    if (this.options.onLaneCreated) {
      this.options.onLaneCreated(laneId, name);
    }
  }

  private handleLaneCleaned(event: BusEvent): void {
    this.recordEventReceived();

    const laneId = event.payload.laneId;

    if (!laneId) return;

    if (this.options.onLaneCleaned) {
      this.options.onLaneCleaned(laneId);
    }
  }

  private handleOrphanDetectionCycle(event: BusEvent): void {
    this.recordEventReceived();

    const orphanedLanes = event.payload.orphanedLanes || [];

    // Notify about orphan status changes
    if (this.options.onOrphanStatusChanged) {
      for (const laneId of orphanedLanes) {
        this.options.onOrphanStatusChanged?.(laneId, true);
      }
    }
  }

  private recordEventReceived(): void {
    this.lastEventTime = Date.now();

    if (!this.isConnected) {
      this.isConnected = true;
      if (this.options.onBusConnectivityIssue) {
        this.options.onBusConnectivityIssue(false);
      }
    }

    this.resetConnectivityTimeout();
  }

  private startConnectivityMonitoring(): void {
    this.resetConnectivityTimeout();
  }

  private stopConnectivityMonitoring(): void {
    if (this.connectivityTimeoutId) {
      clearTimeout(this.connectivityTimeoutId);
    }
  }

  private resetConnectivityTimeout(): void {
    this.stopConnectivityMonitoring();

    this.connectivityTimeoutId = setTimeout(() => {
      if (!this.isConnected) return;

      this.isConnected = false;
      if (this.options.onBusConnectivityIssue) {
        this.options.onBusConnectivityIssue(true);
      }
    }, this.options.busTimeoutMs);
  }

  private scheduleRender(): void {
    if (this.rafId) return;

    this.rafId = (
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
    )(() => {
      this.rafId = undefined;
      this.processPendingUpdates();
    });
  }

  private processPendingUpdates(): void {
    this.pendingUpdates.forEach((event, laneId) => {
      const newState = event.payload.state;
      if (this.options.onStateChanged) {
        this.options.onStateChanged(laneId, newState);
      }
    });

    this.pendingUpdates.clear();
  }
}

export function createLaneEventHandler(options: LaneEventHandlerOptions): LaneEventHandler {
  return new LaneEventHandler(options);
}
