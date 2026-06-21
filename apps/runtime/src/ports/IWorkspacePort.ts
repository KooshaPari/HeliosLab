/**
 * Primary port: Workspace management
 *
 * Defines the hexagonal-architecture primary port for workspace
 * lifecycle operations.  The domain core depends only on this
 * interface; storage adapters (in-memory, SQLite, …) implement it.
 *
 * FR-003: The runtime MUST allow creation, retrieval, and deletion of
 *         isolated workspace contexts identified by typed ws_ IDs.
 * FR-004: Workspace names MUST be unique within a runtime instance.
 */

import type { Workspace, WorkspaceState } from "../../src/runtime/types.js";

export interface WorkspaceCreateOptions {
  readonly name: string;
  readonly rootPath: string;
}

export interface WorkspaceQuery {
  readonly state?: WorkspaceState;
}

/**
 * IWorkspacePort — primary port for workspace lifecycle.
 *
 * @see apps/runtime/src/workspace/workspace.ts — default adapter
 */
export interface IWorkspacePort {
  /** Create a new workspace; throws if name already exists. */
  create(opts: WorkspaceCreateOptions): Promise<Workspace>;

  /** Find a workspace by ID; returns null if not found. */
  findById(id: string): Promise<Workspace | null>;

  /** List workspaces, optionally filtered by state. */
  list(query?: WorkspaceQuery): Promise<readonly Workspace[]>;

  /** Mark a workspace closed; rejects if active sessions remain. */
  close(id: string): Promise<void>;

  /** Permanently delete a closed workspace. */
  delete(id: string): Promise<void>;
}
