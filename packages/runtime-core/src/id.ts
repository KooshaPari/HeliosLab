/**
 * ID generation utilities for the Helios platform.
 *
 * Provides deterministic, prefix-based IDs for conversations, messages,
 * lanes, sessions, terminals, and protocol correlation.
 *
 * wraps: nothing — pure first-party extraction
 */

let _messageCounter = 0;

/**
 * Returns a monotonically increasing counter + timestamp message ID.
 * Safe for use within a single runtime process; not globally unique.
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${++_messageCounter}`;
}

/**
 * Resets the message ID counter. Intended for use in tests only.
 */
export function _resetMessageIdCounter(): void {
  _messageCounter = 0;
}

/**
 * Returns a conversation ID based on the current timestamp.
 */
export function generateConversationId(): string {
  return `conv-${Date.now()}`;
}

/**
 * Returns a correlation ID for protocol envelopes. Embeds the method
 * name and a short random suffix for human-readable tracing.
 */
export function generateCorrelationId(method: string): string {
  return `${method}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns a lane ID scoped to a workspace.
 */
export function generateLaneId(workspaceId: string): string {
  return `${workspaceId}:lane`;
}

/**
 * Returns a session ID scoped to a lane.
 */
export function generateSessionId(laneId: string): string {
  return `${laneId}:session`;
}

/**
 * Returns a terminal ID scoped to a session.
 */
export function generateTerminalId(sessionId: string): string {
  return `${sessionId}:terminal`;
}
