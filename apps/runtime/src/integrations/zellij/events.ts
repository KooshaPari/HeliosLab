/**
 * T011 - Mux event relay.
 *
 * Defines all mux event types and provides a fire-and-forget
 * event emitter that publishes to an event bus without blocking callers.
 */

import type { PaneDimensions } from "./types.js";

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

export const MuxEventType = {
	SESSION_CREATED: "mux.session.created",
	SESSION_REATTACHED: "mux.session.reattached",
	SESSION_TERMINATED: "mux.session.terminated",
	PANE_ADDED: "mux.pane.added",
	PANE_CLOSED: "mux.pane.closed",
	PANE_RESIZED: "mux.pane.resized",
	PANE_PTY_BOUND: "mux.pane.pty_bound",
	PANE_DIMENSION_REJECTED: "mux.pane.dimension_rejected",
	TAB_CREATED: "mux.tab.created",
	TAB_CLOSED: "mux.tab.closed",
	TAB_SWITCHED: "mux.tab.switched",
} as const;

export type MuxEventTypeValue =
	(typeof MuxEventType)[keyof typeof MuxEventType];

// ---------------------------------------------------------------------------
// Base event envelope
// ---------------------------------------------------------------------------

export interface MuxEventBase {
	type: MuxEventTypeValue;
	sessionName: string;
	laneId: string;
	timestamp: number;
	correlationId: string;
}

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

export interface SessionCreatedEvent extends MuxEventBase {
	type: typeof MuxEventType.SESSION_CREATED;
}

export interface SessionReattachedEvent extends MuxEventBase {
	type: typeof MuxEventType.SESSION_REATTACHED;
	recoveredPaneCount: number;
	recoveredTabCount: number;
}

export interface SessionTerminatedEvent extends MuxEventBase {
	type: typeof MuxEventType.SESSION_TERMINATED;
}

// ---------------------------------------------------------------------------
// Pane events
// ---------------------------------------------------------------------------

export interface PaneAddedEvent extends MuxEventBase {
	type: typeof MuxEventType.PANE_ADDED;
	paneId: number;
	dimensions: PaneDimensions;
}

export interface PaneClosedEvent extends MuxEventBase {
	type: typeof MuxEventType.PANE_CLOSED;
	paneId: number;
}

export interface PaneResizedEvent extends MuxEventBase {
	type: typeof MuxEventType.PANE_RESIZED;
	paneId: number;
	oldDimensions: PaneDimensions;
	newDimensions: PaneDimensions;
}

export interface PanePtyBoundEvent extends MuxEventBase {
	type: typeof MuxEventType.PANE_PTY_BOUND;
	paneId: number;
	ptyId: string;
}

export interface PaneDimensionRejectedEvent extends MuxEventBase {
	type: typeof MuxEventType.PANE_DIMENSION_REJECTED;
	paneId: number;
	requestedDimensions: PaneDimensions;
	minDimensions: PaneDimensions;
}

// ---------------------------------------------------------------------------
// Tab events
// ---------------------------------------------------------------------------

export interface TabCreatedEvent extends MuxEventBase {
	type: typeof MuxEventType.TAB_CREATED;
	tabId: number;
	tabName: string;
}

export interface TabClosedEvent extends MuxEventBase {
	type: typeof MuxEventType.TAB_CLOSED;
	tabId: number;
}

export interface TabSwitchedEvent extends MuxEventBase {
	type: typeof MuxEventType.TAB_SWITCHED;
	fromTabId: number;
	toTabId: number;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type MuxEvent =
	| SessionCreatedEvent
	| SessionReattachedEvent
	| SessionTerminatedEvent
	| PaneAddedEvent
	| PaneClosedEvent
	| PaneResizedEvent
	| PanePtyBoundEvent
	| PaneDimensionRejectedEvent
	| TabCreatedEvent
	| TabClosedEvent
	| TabSwitchedEvent;

// ---------------------------------------------------------------------------
// Event bus interface (minimal contract for DI)
// ---------------------------------------------------------------------------

export interface EventBus {
	publish(event: MuxEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Correlation ID generator
// ---------------------------------------------------------------------------

let correlationCounter = 0;

export function generateCorrelationId(): string {
	return `mux-${Date.now()}-${++correlationCounter}`;
}

// ---------------------------------------------------------------------------
// MuxEventEmitter - fire-and-forget wrapper around an EventBus
// ---------------------------------------------------------------------------

export class MuxEventEmitter {
	private readonly bus: EventBus;

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	/**
	 * Emit an event. Bus failures are caught and logged but never propagated.
	 */
	emit(event: MuxEvent): void {
		this.bus.publish(event).catch((err) => {
			console.warn(
				`[mux-events] Bus publish failed for ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
			);
		});
	}

	/**
	 * Helper to build and emit a typed event with common fields populated.
	 */
	emitTyped<T extends MuxEvent>(
		partial: Omit<T, "timestamp" | "correlationId"> & {
			correlationId?: string;
		},
	): void {
		const event = {
			...partial,
			timestamp: Date.now(),
			correlationId: partial.correlationId ?? generateCorrelationId(),
		} as unknown as MuxEvent;
		this.emit(event);
	}
}
