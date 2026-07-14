import {
  BindingState,
  type BindingTriple,
  type RegistryQueryInterface,
  type TerminalBinding,
  type ValidationResult,
} from "./binding_triple_types.js";

export type BindingTripleValidationOptions = {
  skipReferenceChecks?: boolean;
};

function isValidIdFormat(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.length < 1 || id.length > 36) return false;
  return /^[a-z0-9-]+$/.test(id);
}

export function validateBindingTriple(
  triple: BindingTriple,
  queryInterface: RegistryQueryInterface,
  options: BindingTripleValidationOptions = {}
): ValidationResult {
  const errors: string[] = [];

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

  if (!options.skipReferenceChecks) {
    if (!queryInterface.workspaceExists(triple.workspaceId)) {
      errors.push(`Workspace does not exist: ${triple.workspaceId}`);
    }
    if (!queryInterface.laneExists(triple.laneId)) {
      errors.push(`Lane does not exist: ${triple.laneId}`);
    }
    if (!queryInterface.sessionExists(triple.sessionId)) {
      errors.push(`Session does not exist: ${triple.sessionId}`);
    }

    if (
      queryInterface.laneExists(triple.laneId) &&
      queryInterface.workspaceExists(triple.workspaceId)
    ) {
      if (!queryInterface.laneInWorkspace(triple.laneId, triple.workspaceId)) {
        errors.push(`Lane ${triple.laneId} does not belong to workspace ${triple.workspaceId}`);
      }
    }
    if (
      queryInterface.sessionExists(triple.sessionId) &&
      queryInterface.laneExists(triple.laneId)
    ) {
      if (!queryInterface.sessionInLane(triple.sessionId, triple.laneId)) {
        errors.push(`Session ${triple.sessionId} does not belong to lane ${triple.laneId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

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
