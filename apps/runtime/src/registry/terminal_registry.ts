/**
 * Terminal Registry
 *
 * Authoritative store for terminal bindings with multi-key indexing.
 * Maintains fast lookups by terminal_id, lane_id, session_id, or workspace_id.
 */

import type { BindingTriple, RegistryQueryInterface, TerminalBinding } from "./binding_triple.js";
import { BindingState, createBinding, validateBindingTriple } from "./binding_triple.js";

export class RegistryError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export class DuplicateTerminalId extends RegistryError {
  constructor(terminalId: string) {
    super("DUPLICATE_TERMINAL_ID", `Terminal ${terminalId} already exists`);
  }
}

export class DuplicateSessionId extends RegistryError {
  constructor(sessionId: string) {
    super("DUPLICATE_SESSION_ID", `Session ${sessionId} is already bound`);
  }
}

export class InvalidBinding extends RegistryError {
  constructor(errors: string[]) {
    super("INVALID_BINDING", `Binding validation failed: ${errors.join("; ")}`);
  }
}

export class TerminalNotFound extends RegistryError {
  constructor(terminalId: string) {
    super("TERMINAL_NOT_FOUND", `Terminal ${terminalId} not found`);
  }
}

/**
 * Multi-indexed terminal registry with CRUD operations.
 *
 * Maintains:
 * - Primary index: terminalId -> TerminalBinding
 * - Secondary indexes: laneId -> Set<terminalId>, sessionId -> Set<terminalId>, workspaceId -> Set<terminalId>
 * - Uniqueness constraints: terminal_id (enforced), session_id (per lane)
 */
export class TerminalRegistry implements RegistryQueryInterface {
  private primaryStore = new Map<string, TerminalBinding>();
  private laneIndex = new Map<string, Set<string>>();
  private sessionIndex = new Map<string, Set<string>>();
  private workspaceIndex = new Map<string, Set<string>>();
  private sessionPerLaneIndex = new Map<string, Map<string, Set<string>>>();

  /**
   * Register a new terminal with a binding triple.
   *
   * Validates triple, checks terminal uniqueness, and updates all indexes.
   * Rejects if terminal_id already exists or triple is invalid.
   */
  register(terminalId: string, triple: BindingTriple): TerminalBinding {
    // Check duplicate terminal_id
    if (this.primaryStore.has(terminalId)) {
      throw new DuplicateTerminalId(terminalId);
    }

    // Validate binding triple
    const validation = validateBindingTriple(triple, this);
    if (!validation.valid) {
      throw new InvalidBinding(validation.errors);
    }

    // Check for duplicate (lane, session) pair using composite key
    const laneMap = this.sessionPerLaneIndex.get(triple.laneId);
    if (laneMap?.has(triple.sessionId)) {
      throw new DuplicateSessionId(triple.sessionId);
    }

    // Create and store binding
    const binding = createBinding(terminalId, triple);
    this.primaryStore.set(terminalId, binding);

    // Update indexes
    this.addToIndex(this.laneIndex, binding.binding.laneId, terminalId);
    this.addToIndex(this.sessionIndex, binding.binding.sessionId, terminalId);
    this.addToIndex(this.workspaceIndex, binding.binding.workspaceId, terminalId);
    if (!this.sessionPerLaneIndex.has(binding.binding.laneId)) {
      this.sessionPerLaneIndex.set(binding.binding.laneId, new Map());
    }
    if (!this.sessionPerLaneIndex.get(binding.binding.laneId)!.has(binding.binding.sessionId)) {
      this.sessionPerLaneIndex
        .get(binding.binding.laneId)!
        .set(binding.binding.sessionId, new Set());
    }
    this.sessionPerLaneIndex
      .get(binding.binding.laneId)!
      .get(binding.binding.sessionId)!
      .add(terminalId);

    return binding;
  }

  /**
   * Rebind an existing terminal to a new triple.
   * Validates new triple, updates primary + all secondary indexes.
   * Transitions state to 'rebound'.
   */
  rebind(terminalId: string, newTriple: BindingTriple): TerminalBinding {
    const binding = this.primaryStore.get(terminalId);
    if (!binding) {
      throw new TerminalNotFound(terminalId);
    }

    // Validate new binding triple
    const validation = validateBindingTriple(newTriple, this);
    if (!validation.valid) {
      throw new InvalidBinding(validation.errors);
    }

    const oldTriple = binding.binding;

    // Remove from old indexes
    this.removeFromIndex(this.laneIndex, oldTriple.laneId, terminalId);
    this.removeFromIndex(this.sessionIndex, oldTriple.sessionId, terminalId);
    this.removeFromIndex(this.workspaceIndex, oldTriple.workspaceId, terminalId);
    const oldLaneMap = this.sessionPerLaneIndex.get(oldTriple.laneId);
    if (oldLaneMap) {
      const oldSet = oldLaneMap.get(oldTriple.sessionId);
      if (oldSet) oldSet.delete(terminalId);
    }

    // Update binding
    binding.binding = newTriple;
    binding.state = BindingState.rebound;
    binding.updatedAt = Date.now();

    // Add to new indexes
    this.addToIndex(this.laneIndex, newTriple.laneId, terminalId);
    this.addToIndex(this.sessionIndex, newTriple.sessionId, terminalId);
    this.addToIndex(this.workspaceIndex, newTriple.workspaceId, terminalId);
    if (!this.sessionPerLaneIndex.has(newTriple.laneId)) {
      this.sessionPerLaneIndex.set(newTriple.laneId, new Map());
    }
    const newLaneMap = this.sessionPerLaneIndex.get(newTriple.laneId)!;
    if (!newLaneMap.has(newTriple.sessionId)) {
      newLaneMap.set(newTriple.sessionId, new Set());
    }
    newLaneMap.get(newTriple.sessionId)!.add(terminalId);

    return binding;
  }

  /**
   * Unregister a terminal, removing it from all indexes.
   *
   * Transitions state to 'unbound' before removal.
   */
  unregister(terminalId: string): void {
    const binding = this.primaryStore.get(terminalId);
    if (!binding) {
      throw new TerminalNotFound(terminalId);
    }

    const triple = binding.binding;

    // Transition state
    binding.state = BindingState.unbound;
    binding.updatedAt = Date.now();

    // Remove from all indexes
    this.removeFromIndex(this.laneIndex, triple.laneId, terminalId);
    this.removeFromIndex(this.sessionIndex, triple.sessionId, terminalId);
    this.removeFromIndex(this.workspaceIndex, triple.workspaceId, terminalId);
    const laneMap = this.sessionPerLaneIndex.get(triple.laneId);
    if (laneMap) {
      const sessionSet = laneMap.get(triple.sessionId);
      if (sessionSet) {
        sessionSet.delete(terminalId);
        if (sessionSet.size === 0) laneMap.delete(triple.sessionId);
      }
    }

    // Remove from primary store
    this.primaryStore.delete(terminalId);
  }

  /**
   * Get a terminal binding by terminal_id.
   */
  get(terminalId: string): TerminalBinding | undefined {
    return this.primaryStore.get(terminalId);
  }

  /**
   * Query all bindings for a lane.
   */
  getByLane(laneId: string): TerminalBinding[] {
    const terminalIds = this.laneIndex.get(laneId) || new Set();
    return Array.from(terminalIds)
      .map(id => this.primaryStore.get(id))
      .filter(binding => binding !== undefined) as TerminalBinding[];
  }

  /**
   * Query all bindings for a session.
   */
  getBySession(sessionId: string): TerminalBinding[] {
    const terminalIds = this.sessionIndex.get(sessionId) || new Set();
    return Array.from(terminalIds)
      .map(id => this.primaryStore.get(id))
      .filter(binding => binding !== undefined) as TerminalBinding[];
  }

  /**
   * Query all bindings for a workspace.
   */
  getByWorkspace(workspaceId: string): TerminalBinding[] {
    const terminalIds = this.workspaceIndex.get(workspaceId) || new Set();
    return Array.from(terminalIds)
      .map(id => this.primaryStore.get(id))
      .filter(binding => binding !== undefined) as TerminalBinding[];
  }

  /**
   * Get all terminal bindings.
   */
  getAll(): TerminalBinding[] {
    return Array.from(this.primaryStore.values());
  }

  /**
   * Implement RegistryQueryInterface for validation callbacks.
   */
  workspaceExists(_workspaceId: string): boolean {
    return true; // External validation; assume exists if referenced
  }

  laneExists(_laneId: string): boolean {
    return true; // External validation
  }

  sessionExists(_sessionId: string): boolean {
    return true; // External validation
  }

  laneInWorkspace(_laneId: string, _workspaceId: string): boolean {
    return true; // External validation
  }

  sessionInLane(_sessionId: string, _laneId: string): boolean {
    return true; // External validation
  }

  /**
   * Clear all bindings (for testing).
   */
  clear(): void {
    this.primaryStore.clear();
    this.laneIndex.clear();
    this.sessionIndex.clear();
    this.workspaceIndex.clear();
    this.sessionPerLaneIndex.clear();
  }

  // Helpers for index management
  private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    if (!index.has(key)) {
      index.set(key, new Set());
    }
    index.get(key)!.add(value);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    const set = index.get(key);
    if (set) {
      set.delete(value);
      if (set.size === 0) {
        index.delete(key);
      }
    }
  }
}
