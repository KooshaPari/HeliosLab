---
work_package_id: WP02
title: Lifecycle Event Emission, Persistence, and Integration Tests
lane: "done"
dependencies:
- WP01
base_branch: 014-terminal-to-lane-session-binding-WP01
base_commit: f4f8a3b249b6f995e509dcfa42f4bb9a1d64811f
created_at: '2026-03-01T13:31:56.932100+00:00'
subtasks:
- T005
- T006
- T007
- T008
phase: Phase 2 - Durability and Integration
assignee: ''
agent: "claude-haiku"
shell_pid: "64856"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Lifecycle Event Emission, Persistence, and Integration Tests

## Objectives & Success Criteria

- Emit binding lifecycle events (bound, rebound, unbound, validation-failed) on the internal bus for downstream consumers.
- Implement durable persistence so bindings survive runtime restarts.
- Subscribe to lane/session lifecycle events for automatic binding invalidation.
- Deliver integration tests covering persistence, recovery, lifecycle propagation, and latency benchmarks.

Success criteria:
- All binding state changes emit corresponding events on the bus.
- After runtime restart, bindings are restored from durable storage with >=98% accuracy.
- Lane detach/cleanup events automatically invalidate or close affected terminal bindings.
- Latency benchmarks pass: <5ms validation, <2ms lookup at p95 with 500+ bindings.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/014-terminal-to-lane-session-binding/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/014-terminal-to-lane-session-binding/spec.md`
- Terminal registry: `apps/runtime/src/registry/terminal_registry.ts` (WP01)
- Binding middleware: `apps/runtime/src/registry/binding_middleware.ts` (WP01)
- Internal event bus: `apps/runtime/src/protocol/bus.ts` (spec 001)
- Lane lifecycle: spec 008
- Session lifecycle: spec 009

Constraints:
- Persistence must not block the hot path; async writes with in-memory primary.
- Keep files under 500 lines.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T005 - Implement binding lifecycle event emission
- Purpose: notify downstream consumers (UI, audit, orphan detection) of all binding state changes.
- Steps:
  1. Implement `BindingEventEmitter` in `apps/runtime/src/registry/binding_events.ts`:
     a. Define event topic constants: `terminal.binding.bound`, `terminal.binding.rebound`, `terminal.binding.unbound`, `terminal.binding.validation_failed`.
     b. Define event payload schema: `terminalId`, `binding` (the triple), `previousBinding` (if rebound), `state`, `timestamp`, `correlationId`.
  2. Wire the event emitter into `TerminalRegistry` CRUD operations:
     a. `register()` -> emit `bound`.
     b. `rebind()` -> emit `rebound` with previous and new binding.
     c. `unregister()` -> emit `unbound`.
     d. Middleware `validation_failed` state transition -> emit `validation_failed`.
  3. Publish events via the internal bus (`apps/runtime/src/protocol/bus.ts`).
  4. Include correlation ID from the originating operation (terminal creation, lane switch, etc.).
  5. Register event topics in protocol topic registry if applicable.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/binding_events.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/terminal_registry.ts` (wire events)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/binding_middleware.ts` (wire validation_failed event)
- Validation:
  - Unit test: register terminal, assert `bound` event emitted with correct payload.
  - Unit test: rebind terminal, assert `rebound` event includes previous and new binding.
  - Unit test: unregister terminal, assert `unbound` event emitted.
  - Unit test: trigger validation failure, assert `validation_failed` event.
- Parallel: No.

### Subtask T006 - Implement durable persistence adapter
- Purpose: ensure binding state survives runtime restarts for recovery.
- Steps:
  1. Implement `BindingPersistence` in `apps/runtime/src/registry/persistence.ts`:
     a. Interface: `save(bindings: TerminalBinding[]): Promise<void>`, `load(): Promise<TerminalBinding[]>`, `clear(): Promise<void>`.
     b. Implementation: file-backed JSON store or embedded SQLite (prefer simplicity; file-backed JSON for slice-1).
  2. Implement async write strategy:
     a. On binding change, schedule a debounced write (e.g., 500ms) to avoid write storms.
     b. On explicit flush (e.g., before graceful shutdown), write immediately.
     c. Keep in-memory registry as the primary source of truth; persistence is for recovery only.
  3. Implement load-on-startup:
     a. On runtime startup, load persisted bindings into the registry.
     b. Re-validate each loaded binding against current lane/session state.
     c. Discard bindings whose lanes or sessions no longer exist (emit `unbound` events).
  4. Implement integrity checks:
     a. Write a checksum with the persisted data.
     b. On load, verify checksum; if corrupt, discard and start fresh with warning.
  5. File location: use the app's data directory (e.g., `~/.helios/data/binding_registry.json`).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/persistence.ts`
- Validation:
  - Integration test: register 10 bindings, flush, reload, assert all 10 restored.
  - Integration test: corrupt the persistence file, reload, assert graceful recovery with warning.
  - Integration test: register bindings, kill lane, reload, assert stale bindings discarded.
  - Benchmark: write 500 bindings, assert flush completes in <100ms.
- Parallel: No.

### Subtask T007 - Implement lane/session lifecycle subscription for automatic invalidation
- Purpose: automatically invalidate terminal bindings when their lane or session is detached, cleaned up, or terminated.
- Steps:
  1. Subscribe to lane lifecycle events from spec 008:
     a. On `lane.detached` or `lane.cleaned_up`: look up all terminals bound to that lane via `getByLane(laneId)`.
     b. For each affected terminal: either unregister (close terminal) or transition to `unbound` state depending on the event type.
     c. Emit corresponding `unbound` events for each affected terminal.
  2. Subscribe to session lifecycle events from spec 009:
     a. On `session.terminated` or `session.expired`: look up all terminals bound to that session via `getBySession(sessionId)`.
     b. Unregister affected terminals and emit `unbound` events.
  3. Implement recovery-aware suppression:
     a. If a lane or session is in `recovering` state, do not invalidate its bindings.
     b. Cross-reference active recovery operations before invalidating.
  4. Wire subscriptions in the registry initialization path.
  5. Log invalidation actions for debugging.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/terminal_registry.ts` (lifecycle subscriptions)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/registry/binding_events.ts` (event emission)
- Validation:
  - Integration test: emit lane.cleaned_up event, verify all terminals for that lane are unregistered.
  - Integration test: emit session.terminated event, verify affected terminals unregistered.
  - Integration test: emit lane.detached while lane is recovering, verify bindings are NOT invalidated.
- Parallel: No.

### Subtask T008 - Add integration tests and latency benchmarks
- Purpose: validate the complete binding lifecycle including persistence, restart recovery, and performance SLOs.
- Steps:
  1. Create `apps/runtime/tests/integration/registry/binding_lifecycle.test.ts`:
     a. Test full lifecycle: register -> rebind -> unregister with event verification at each step.
     b. Test concurrent binding changes across multiple terminals.
     c. Test binding consistency after rapid lane switches.
  2. Create `apps/runtime/tests/integration/registry/persistence.test.ts`:
     a. Test save and reload cycle with 100 bindings.
     b. Test restart recovery: register bindings, simulate restart, verify restoration.
     c. Test corrupt file recovery.
     d. Test stale binding pruning on reload.
  3. Create `apps/runtime/tests/integration/registry/lane_session_integration.test.ts`:
     a. Test lane cleanup triggers binding invalidation.
     b. Test session termination triggers binding invalidation.
     c. Test recovery suppression (no invalidation during active recovery).
  4. Create `apps/runtime/tests/integration/registry/latency_benchmarks.test.ts`:
     a. Register 500+ bindings.
     b. Benchmark lookup by terminal_id: assert p95 < 2ms.
     c. Benchmark lookup by lane_id: assert p95 < 2ms.
     d. Benchmark validation middleware: assert p95 < 5ms.
  5. Aim for >=85% line coverage across all registry modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/registry/binding_lifecycle.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/registry/persistence.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/registry/lane_session_integration.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/registry/latency_benchmarks.test.ts`
- Parallel: Yes (after T005/T006/T007 are implemented).

## Test Strategy

- Integration tests with real file-backed persistence.
- Lifecycle event verification using bus event capture.
- Latency benchmarks with 500+ bindings for SLO validation.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: persistence write storms during rapid binding changes.
- Mitigation: debounced writes with immediate flush on shutdown.
- Risk: lifecycle event subscription misses events during startup race.
- Mitigation: subscribe before loading persisted bindings; re-validate after load.

## Review Guidance

- Confirm events are emitted for every binding state change path.
- Confirm persistence uses async writes with immediate flush on shutdown.
- Confirm lane/session lifecycle subscriptions correctly invalidate affected bindings.
- Confirm recovery-aware suppression prevents false invalidation.
- Confirm latency benchmarks use sufficient binding counts.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:31:57Z – claude-haiku – shell_pid=64856 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:18Z – claude-haiku – shell_pid=64856 – lane=done – Implemented: Event emission, persistence adapter, lifecycle subscriptions, and comprehensive integration tests
