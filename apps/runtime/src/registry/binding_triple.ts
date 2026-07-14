/**
 * Terminal Binding Triple Type System
 *
 * Defines the authoritative type system for terminal-to-context bindings.
 * A binding triple represents the execution context of a terminal:
 * (workspace_id, lane_id, session_id)
 */

export interface BindingTriple {
  workspaceId: string;
  laneId: string;
  sessionId: string;
}

export enum BindingState {
  bound = "bound",
  rebound = "rebound",
  unbound = "unbound",
  validation_failed = "validation_failed",
}

export interface TerminalBinding {
  terminalId: string;
  binding: BindingTriple;
  state: BindingState;
  createdAt: number;
  updatedAt: number;
}

export interface RegistryQueryInterface {
  workspaceExists(workspaceId: string): boolean;
  laneExists(laneId: string): boolean;
  sessionExists(sessionId: string): boolean;
  laneInWorkspace(laneId: string, workspaceId: string): boolean;
  sessionInLane(sessionId: string, laneId: string): boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that an ID conforms to the standard format (spec 005).
 * Standard format: lowercase alphanumeric with hyphens, 1-36 characters.
 */
function isValidIdFormat(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length < 1 || id.length > 36) return false;
  return /^[a-z0-9-]+$/.test(id);
}

/**
 * Validates a binding triple against the current state of registries.
 *
 * Checks:
 * - All IDs conform to ID standard format (spec 005)
 * - Workspace, lane, and session exist in their respective registries
 * - Lane belongs to workspace
 * - Session belongs to lane
 */
export function validateBindingTriple(
  triple: BindingTriple,
  queryInterface: RegistryQueryInterface
): ValidationResult {
  const errors: string[] = [];

  // Validate ID formats
  if (!isValidIdFormat(triple.workspaceId)) {
    errors.push(
      `Invalid workspace ID format: ${triple.workspaceId} (must be 1-36 lowercase alphanumeric/hyphens)`
    );
  }
  if (!isValidIdFormat(triple.laneId)) {
    errors.push(
      `Invalid lane ID format: ${triple.laneId} (must be 1-36 lowercase alphanumeric/hyphens)`
    );
  }
  if (!isValidIdFormat(triple.sessionId)) {
    errors.push(
      `Invalid session ID format: ${triple.sessionId} (must be 1-36 lowercase alphanumeric/hyphens)`
    );
  }

  // Validate existence in registries
  if (!queryInterface.workspaceExists(triple.workspaceId)) {
    errors.push(`Workspace does not exist: ${triple.workspaceId}`);
  }
  if (!queryInterface.laneExists(triple.laneId)) {
    errors.push(`Lane does not exist: ${triple.laneId}`);
  }
  if (!queryInterface.sessionExists(triple.sessionId)) {
    errors.push(`Session does not exist: ${triple.sessionId}`);
  }

  // Validate cross-references
  if (!queryInterface.laneInWorkspace(triple.laneId, triple.workspaceId)) {
    errors.push(`Lane ${triple.laneId} does not belong to workspace ${triple.workspaceId}`);
  }
  if (!queryInterface.sessionInLane(triple.sessionId, triple.laneId)) {
    errors.push(`Session ${triple.sessionId} does not belong to lane ${triple.laneId}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a new terminal binding with the given terminal ID and binding triple.
 * Factory function that initializes all required fields.
 */
export function createBinding(terminalId: string, triple: BindingTriple): TerminalBinding {
  const now = Date.now();
  return {
    terminalId,
    binding: triple,
    state: BindingState.bound,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTerminalBinding(terminalId: string, triple: BindingTriple): TerminalBinding {
  return createBinding(terminalId, triple);
}
