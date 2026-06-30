/**
 * Shared conversation and message types for the Helios platform.
 *
 * These types are used by both the heliosApp renderer and the colab-renderer.
 * Single source of truth extracted from apps/runtime/src/types/conversation.ts.
 *
 * wraps: nothing — pure first-party extraction
 */

export type MessageStatus = "pending" | "streaming" | "complete" | "error" | "cancelled";

export type MessageRole = "user" | "assistant" | "system" | "tool_call" | "tool_result";

export type MessageMetadata = {
  status?: MessageStatus;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  [key: string]: unknown;
};

export type Message = {
  id: string;
  conversationId?: string;
  role: MessageRole;
  content: string;
  timestamp: number | string;
  metadata?: MessageMetadata;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  modelId?: string;
  createdAt: number | string;
  updatedAt: number | string;
  metadata?: Record<string, unknown>;
};

/**
 * Protocol envelope types for LocalBus communication.
 *
 * Extracted from packages/types/src/index.ts for shared use.
 */
export type EnvelopeType = "command" | "response" | "event";

export interface BaseEnvelope {
  readonly id: string;
  readonly type: EnvelopeType;
  readonly ts: string;
  readonly correlation_id?: string;
}

export interface CommandEnvelope extends BaseEnvelope {
  readonly type: "command";
  readonly method: string;
  readonly workspace_id?: string;
  readonly lane_id?: string;
  readonly session_id?: string;
  readonly terminal_id?: string;
  readonly payload: Record<string, unknown>;
}

export interface ResponseEnvelope extends BaseEnvelope {
  readonly type: "response";
  readonly method: string;
  readonly status: "ok" | "error";
  readonly result?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface EventEnvelope extends BaseEnvelope {
  readonly type: "event";
  readonly topic: string;
  readonly workspace_id?: string;
  readonly lane_id?: string;
  readonly session_id?: string;
  readonly terminal_id?: string;
  readonly payload: Record<string, unknown>;
}

export type LocalBusEnvelope = CommandEnvelope | ResponseEnvelope | EventEnvelope;

/**
 * Workspace and lane types.
 */
export type WorkspaceState = "active" | "closed" | "deleted";
export type LaneState = "creating" | "active" | "closed" | "failed";
export type TerminalState = "spawning" | "running" | "throttled" | "closed";

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly state: WorkspaceState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Lane {
  readonly id: string;
  readonly workspaceId: string;
  readonly state: LaneState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Session {
  readonly id: string;
  readonly laneId: string;
  readonly terminalId: string;
  readonly workspaceId: string;
  readonly createdAt: number;
  readonly state: "active" | "detached" | "terminated";
}

export interface Terminal {
  readonly id: string;
  readonly sessionId: string;
  readonly state: TerminalState;
  readonly createdAt: number;
}
