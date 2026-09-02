/**
 * Binding Lifecycle Event Emission
 *
 * Emits events for all binding state changes: bound, rebound, unbound, validation_failed.
 * Events are published via the internal bus for downstream consumers.
 */

import type { LocalBus } from "../protocol/bus.js";
import { randomUUID } from "node:crypto";
const uuidv4 = randomUUID;
import type { BindingTriple, TerminalBinding } from "./binding_triple.js";

// Event topics
export const BINDING_TOPICS = {
  BOUND: "terminal.binding.bound",
  REBOUND: "terminal.binding.rebound",
  UNBOUND: "terminal.binding.unbound",
  VALIDATION_FAILED: "terminal.binding.validation_failed",
} as const;

export type BindingEventTopic = (typeof BINDING_TOPICS)[keyof typeof BINDING_TOPICS];

export interface BindingEventPayload {
  terminalId: string;
  binding: BindingTriple;
  previousBinding?: BindingTriple;
  state: string;
  timestamp: string;
  correlationId: string;
}

/**
 * Emits binding lifecycle events on the internal bus.
 *
 * Publishes events with structured payloads for downstream consumers:
 * - UI state updates
 * - Audit logging
 * - Orphan detection
 * - Binding lifecycle tracking
 */
export class BindingEventEmitter {
  constructor(private bus: LocalBus) {}

  /**
   * Emit event for a terminal binding state change.
   */
  private async emitEvent(topic: BindingEventTopic, payload: BindingEventPayload): Promise<void> {
    const event = {
      id: uuidv4(),
      type: "event" as const,
      ts: new Date().toISOString(),
      topic,
      terminal_id: payload.terminalId,
      lane_id: payload.binding.laneId,
      session_id: payload.binding.sessionId,
      workspace_id: payload.binding.workspaceId,
      payload,
    };

    try {
      await this.bus.publish(event as any);
    } catch (error) {
      console.error(`Failed to emit binding event ${topic}:`, error);
    }
  }

  /**
   * Emit 'bound' event when a terminal is registered.
   */
  async emitBound(binding: TerminalBinding, correlationId: string = uuidv4()): Promise<void> {
    await this.emitEvent(BINDING_TOPICS.BOUND, {
      terminalId: binding.terminalId,
      binding: binding.binding,
      state: binding.state,
      timestamp: new Date(binding.createdAt).toISOString(),
      correlationId,
    });
  }

  /**
   * Emit 'rebound' event when a terminal's binding changes.
   */
  async emitRebound(
    binding: TerminalBinding,
    previousBinding: BindingTriple,
    correlationId: string = uuidv4()
  ): Promise<void> {
    await this.emitEvent(BINDING_TOPICS.REBOUND, {
      terminalId: binding.terminalId,
      binding: binding.binding,
      previousBinding,
      state: binding.state,
      timestamp: new Date(binding.updatedAt).toISOString(),
      correlationId,
    });
  }

  /**
   * Emit 'unbound' event when a terminal is unregistered.
   */
  async emitUnbound(binding: TerminalBinding, correlationId: string = uuidv4()): Promise<void> {
    await this.emitEvent(BINDING_TOPICS.UNBOUND, {
      terminalId: binding.terminalId,
      binding: binding.binding,
      state: binding.state,
      timestamp: new Date(binding.updatedAt).toISOString(),
      correlationId,
    });
  }

  /**
   * Emit 'validation_failed' event when a binding fails re-validation.
   */
  async emitValidationFailed(
    binding: TerminalBinding,
    reason: string,
    correlationId: string = uuidv4()
  ): Promise<void> {
    const payloadWithReason = {
      terminalId: binding.terminalId,
      binding: binding.binding,
      state: binding.state,
      timestamp: new Date(binding.updatedAt).toISOString(),
      correlationId,
      reason,
    };

    // Emit with reason in payload
    const event = {
      id: uuidv4(),
      type: "event" as const,
      ts: new Date().toISOString(),
      topic: BINDING_TOPICS.VALIDATION_FAILED,
      terminal_id: binding.terminalId,
      lane_id: binding.binding.laneId,
      session_id: binding.binding.sessionId,
      workspace_id: binding.binding.workspaceId,
      payload: payloadWithReason,
    };

    try {
      await this.bus.publish(event as any);
    } catch (error) {
      console.error(`Failed to emit validation_failed event:`, error);
    }
  }
}
