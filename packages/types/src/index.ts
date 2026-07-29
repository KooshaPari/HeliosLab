/**
 * Shared workspace and project types for Helios platform.
 */

export type WorkspaceState = "active" | "closed" | "deleted";

export interface ProjectBinding {
    readonly id: string;
    readonly workspaceId: string;
    readonly rootPath: string;
    readonly gitUrl?: string;
    readonly status: "active" | "stale";
    readonly boundAt: number;
}

export interface Workspace {
    readonly id: string;
    readonly name: string;
    readonly rootPath: string;
    readonly state: WorkspaceState;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface WorkspaceBinding {
    readonly workspace: Workspace;
    readonly projects: ProjectBinding[];
}

/**
 * Session management types.
 */
export interface Session {
    readonly id: string;
    readonly laneId: string;
    readonly terminalId: string;
    readonly workspaceId: string;
    readonly createdAt: number;
    readonly state: "active" | "detached" | "terminated";
}

export interface SessionConfig {
    readonly shell?: string;
    readonly cwd?: string;
    readonly env?: Record<string, string>;
}

/**
 * Lane types.
 */
export type LaneState = "creating" | "active" | "closed" | "failed";

export interface Lane {
    readonly id: string;
    readonly workspaceId: string;
    readonly state: LaneState;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface LaneBinding {
    readonly lane: Lane;
    readonly sessions: Session[];
}

/**
 * Terminal types.
 */
export type TerminalState = "spawning" | "running" | "throttled" | "closed";

export interface Terminal {
    readonly id: string;
    readonly sessionId: string;
    readonly state: TerminalState;
    readonly createdAt: number;
}

/**
 * Checkpoint and state preservation types.
 */
export interface CheckpointSession {
    readonly sessionId: string;
    readonly terminalId: string;
    readonly laneId: string;
    readonly workingDirectory: string;
    readonly environmentVariables: Readonly<Record<string, string>>;
    readonly scrollbackSnapshot: string;
    readonly zelijjSessionName: string;
    readonly shellCommand: string;
}

export interface Checkpoint {
    readonly version: number;
    readonly lanes: CheckpointSession[];
    readonly createdAt: string;
    readonly metadata?: Record<string, unknown>;
}

/**
 * Protocol envelope types.
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
