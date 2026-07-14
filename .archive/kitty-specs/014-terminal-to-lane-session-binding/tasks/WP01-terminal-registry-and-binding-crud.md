---
work_package_id: WP01
title: Terminal Registry, Binding CRUD, and Validation Middleware
lane: "done"
dependencies: []
base_branch: main
base_commit: 442f0c8e7c518264b6c50fae27b9e104b2d17d86
created_at: '2026-03-01T13:29:10.263527+00:00'
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 1 - Registry Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "53584"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Terminal Registry, Binding CRUD, and Validation Middleware

## Objectives & Success Criteria

- Implement the binding triple type system with validation rules.
- Implement the terminal registry with CRUD operations and multi-key indexing.
- Implement pre-operation binding validation middleware that rejects stale/invalid bindings.

Success criteria:
- Every terminal in the registry has a valid (workspace_id, lane_id, session_id) triple.
- Registry rejects duplicate terminal_ids and creation without valid lane/session references.
- Lookups by any key (terminal, lane, session, workspace) return correct results in under 2ms.
- Validation middleware rejects operations on terminals with invalid or stale bindings.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/014-terminal-to-lane-session-binding/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/014-terminal-to-lane-session-binding/spec.md`
- Internal event bus: spec 001 (`apps/runtime/src/protocol/bus.ts`)
- Workspace identity: spec 003
- ID standards: spec 005
- Lane lifecycle: spec 008
- Session lifecycle: spec 009

Constraints:
- No unbound terminals during normal operation.
- Multi-key indexing for fast lookups.
- Keep files under 500 lines.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement binding triple type definitions and validation
- Purpose: define the authoritative type system for terminal-to-context bindings with validation rules.
- Steps:
  1. Define `BindingTriple` interface in `apps/runtime/src/registry/binding_triple.ts`:
     a. Fields: `workspaceId: string`, `laneId: string`, `sessionId: string`.
     b. All fields are required; no optional/nullable fields.
  2. Define `TerminalBinding` interface extending the triple:
     a. Fields: `terminalId: string`, `binding: BindingTriple`, `state: BindingState`, `createdAt: number`, `updatedAt: number`.
     b. `BindingState` enum: `bound`, `rebound`, `unbound`, `validation_failed`.
  3. Implement `validateBindingTriple(triple: BindingTriple): ValidationResult`:
     a. Verify all IDs conform to the ID standard format (spec 005).
     b. Verify workspace, lane, and session exist in their respective registries (accept a registry query interface as parameter).
     c. Verify the lane belongs to the workspace and the session belongs to the lane.
     d. Return structured validation result with specific failure reasons.
  4. Implement `createBinding(terminalId, triple): TerminalBinding` factory function.
  5. Export all types and validation functions.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/binding_triple.ts`
- Validation:
  - Unit test: create binding with valid triple, assert all fields populated.
  - Unit test: validate triple with invalid workspace ID format, assert validation failure.
  - Unit test: validate triple where lane does not belong to workspace, assert cross-reference failure.
  - Unit test: validate triple where session does not belong to lane, assert failure.
- Parallel: No.

### Subtask T002 - Implement terminal registry with CRUD and multi-key indexing
- Purpose: build the authoritative store for terminal bindings with fast lookups by any key.
- Steps:
  1. Implement `TerminalRegistry` class in `apps/runtime/src/registry/terminal_registry.ts`:
     a. Internal storage: primary `Map<terminalId, TerminalBinding>`.
     b. Secondary indexes: `Map<laneId, Set<terminalId>>`, `Map<sessionId, Set<terminalId>>`, `Map<workspaceId, Set<terminalId>>`.
  2. Implement CRUD operations:
     a. `register(terminalId, triple)`: validate triple, check uniqueness, insert into primary + all indexes. Reject if terminal_id exists or triple is invalid.
     b. `rebind(terminalId, newTriple)`: validate new triple, update primary + adjust all indexes. Transition state to `rebound`.
     c. `unregister(terminalId)`: remove from primary + all indexes. Transition state to `unbound` before removal.
     d. `get(terminalId)`: return binding or undefined.
  3. Implement multi-key queries:
     a. `getByLane(laneId): TerminalBinding[]`
     b. `getBySession(sessionId): TerminalBinding[]`
     c. `getByWorkspace(workspaceId): TerminalBinding[]`
     d. `getAll(): TerminalBinding[]`
  4. Implement uniqueness enforcement:
     a. Reject registration if terminal_id already exists with `DuplicateTerminalId` error.
     b. Detect if two terminals claim the same session_id (if unique-session constraint applies) and reject.
  5. Thread-safety: since Bun is single-threaded, use synchronous operations but guard against re-entrancy via state flags if needed.
  6. Export the registry class and error types.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/terminal_registry.ts`
- Validation:
  - Unit test: register 3 terminals, query by each key type, verify correct results.
  - Unit test: attempt duplicate terminal_id registration, assert rejection.
  - Unit test: rebind terminal to new lane, verify old lane index updated, new lane index updated.
  - Unit test: unregister terminal, verify removed from all indexes.
  - Benchmark: register 1000 terminals, verify lookup by any key completes in <2ms.
- Parallel: No.

### Subtask T003 - Implement pre-operation binding validation middleware
- Purpose: intercept terminal operations and reject those with stale or invalid bindings.
- Steps:
  1. Implement `BindingMiddleware` in `apps/runtime/src/registry/binding_middleware.ts`:
     a. Accept a `TerminalRegistry` instance as dependency.
     b. Expose `validateBeforeOperation(terminalId, operation): ValidationResult`.
  2. Validation checks:
     a. Terminal exists in registry (reject with `TerminalNotFound`).
     b. Terminal binding state is `bound` or `rebound` (reject if `unbound` or `validation_failed`).
     c. Binding triple is still valid: lane exists, session exists, lane belongs to workspace (re-validate against current state).
     d. If re-validation fails, update binding state to `validation_failed` and reject.
  3. Implement middleware integration point:
     a. Export a function that wraps terminal operation handlers.
     b. The wrapper calls `validateBeforeOperation` before the handler; on failure, returns structured error to the caller.
  4. Measure validation overhead: the middleware must add less than 5ms at p95.
  5. Log validation failures for debugging (emit validation-failed event via bus in WP02).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/binding_middleware.ts`
- Validation:
  - Unit test: validate operation on terminal with valid binding, assert pass.
  - Unit test: validate operation on terminal whose lane was cleaned up, assert rejection with `validation_failed`.
  - Unit test: validate operation on unregistered terminal, assert `TerminalNotFound`.
  - Benchmark: run 1000 sequential validations, assert p95 < 5ms.
- Parallel: No.

### Subtask T004 - Add unit and property-based tests
- Purpose: lock registry behavior with exhaustive tests and consistency invariants.
- Steps:
  1. Create `apps/runtime/tests/unit/registry/binding_triple.test.ts`:
     a. Test valid triple creation and validation.
     b. Test invalid ID format detection.
     c. Test cross-reference validation (lane-in-workspace, session-in-lane).
  2. Create `apps/runtime/tests/unit/registry/terminal_registry.test.ts`:
     a. Test full CRUD lifecycle (register, get, rebind, unregister).
     b. Test multi-key indexing correctness.
     c. Test uniqueness enforcement (duplicate terminal_id, duplicate session claim).
     d. Property-based test: after N random register/rebind/unregister operations, all indexes are consistent with primary store.
  3. Create `apps/runtime/tests/unit/registry/binding_middleware.test.ts`:
     a. Test valid binding passes middleware.
     b. Test stale binding rejected.
     c. Test unregistered terminal rejected.
     d. Test middleware updates binding state to `validation_failed` on stale detection.
  4. Use Vitest + a property-based testing library (e.g., fast-check).
  5. Aim for >=90% line coverage on registry modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/registry/binding_triple.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/registry/terminal_registry.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/registry/binding_middleware.test.ts`
- Parallel: Yes (after T001/T002/T003 interfaces are stable).

## Test Strategy

- Unit tests with Vitest for CRUD and validation logic.
- Property-based tests for consistency invariants (indexes match primary store after random operations).
- Benchmarks for latency SLOs (2ms lookup, 5ms validation).
- Aim for >=90% line coverage on all registry modules.

## Risks & Mitigations

- Risk: multi-key index inconsistency after rebind/unregister.
- Mitigation: property-based tests verify index consistency after random operation sequences.
- Risk: validation re-check overhead slows terminal operations.
- Mitigation: benchmark validates <5ms overhead; in-memory indexes make re-checks fast.

## Review Guidance

- Confirm all CRUD paths update all secondary indexes correctly.
- Confirm validation middleware re-validates against current state, not cached state.
- Confirm uniqueness enforcement covers both terminal_id and session_id constraints.
- Confirm property-based tests use sufficient operation counts for confidence.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:10Z – claude-haiku – shell_pid=53584 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:31:39Z – claude-haiku – shell_pid=53584 – lane=done – Implemented: Terminal registry with CRUD, binding validation middleware, and comprehensive tests
