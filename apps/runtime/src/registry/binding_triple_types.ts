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
