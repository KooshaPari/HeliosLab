/**
 * Primary port: Session lifecycle
 *
 * Defines the hexagonal-architecture primary port for managing the
 * agent-session lifecycle (create, checkpoint, restore, terminate).
 *
 * Referenced FRs map to specs/027-crash-recovery-and-restoration
 * and specs/009-zellij-mux-session-adapter.
 */

import type { Session } from "../../packages/runtime-core/src/types.js";

export interface SessionCreateOptions {
  readonly laneId: string;
  readonly workspaceId: string;
}

export interface SessionCheckpoint {
  readonly sessionId: string;
  readonly checkpointAt: string;   // ISO-8601
  readonly metadata: Record<string, unknown>;
}

/**
 * ISessionPort — primary port for session lifecycle management.
 *
 * @see apps/runtime/src/sessions/ — default adapters
 */
export interface ISessionPort {
  /** Spawn a new session inside the given lane. */
  create(opts: SessionCreateOptions): Promise<Session>;

  /** Find a session by ID; null if not found. */
  findById(sessionId: string): Promise<Session | null>;

  /** Persist a checkpoint so the session can survive a crash. */
  checkpoint(sessionId: string, meta: Record<string, unknown>): Promise<SessionCheckpoint>;

  /** Restore a previously checkpointed session. */
  restore(sessionId: string): Promise<Session>;

  /** Gracefully terminate a session and release its resources. */
  terminate(sessionId: string): Promise<void>;
}
