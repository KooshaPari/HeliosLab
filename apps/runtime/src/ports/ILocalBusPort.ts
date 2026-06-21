/**
 * Primary port: Local Message Bus
 *
 * Defines the hexagonal-architecture primary port for the LocalBus
 * event-driven message dispatch layer.  Concrete adapters (in-process
 * LocalBus, test-double NoopBus, etc.) implement this interface.
 *
 * FR-001: The runtime MUST route all inter-component messages through
 *         a single bus port so components remain decoupled.
 * FR-002: The bus port MUST support command dispatch with correlated
 *         response delivery.
 */

import type { CommandEnvelope, ResponseEnvelope, EventEnvelope } from "../protocol/types.js";

/** Handler registered for a method name on the bus. */
export type CommandHandler = (
  command: CommandEnvelope,
) => Promise<ResponseEnvelope>;

/** Subscriber notified of bus-wide events. */
export type EventSubscriber = (event: EventEnvelope) => void | Promise<void>;

/**
 * ILocalBusPort — primary port for message bus interactions.
 *
 * @see apps/runtime/src/protocol/bus.ts — default adapter
 */
export interface ILocalBusPort {
  /** Register a handler for a given method name. */
  register(method: string, handler: CommandHandler): void;

  /** Dispatch a command envelope; returns the correlated response. */
  dispatch(command: CommandEnvelope): Promise<ResponseEnvelope>;

  /** Publish an event to all subscribed listeners. */
  publish(event: EventEnvelope): Promise<void>;

  /** Subscribe to a topic pattern; returns an unsubscribe function. */
  subscribe(topic: string, subscriber: EventSubscriber): () => void;
}
