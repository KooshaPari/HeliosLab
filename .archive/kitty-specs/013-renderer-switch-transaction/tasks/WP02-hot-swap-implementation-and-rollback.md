---
work_package_id: WP02
title: Hot-Swap Implementation and Rollback
lane: "done"
dependencies:
- WP01
base_branch: 013-renderer-switch-transaction-WP01
base_commit: c50a79b1b9987f1e4163a5aa7079bad940c79ac1
created_at: '2026-03-01T13:31:18.415662+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
phase: Phase 2 - Core Switching
assignee: ''
agent: "claude-haiku"
shell_pid: "61191"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Hot-Swap Implementation and Rollback

## Objectives & Success Criteria

- Implement the hot-swap renderer transition path that atomically transitions all active terminals from source to target renderer.
- Implement automatic rollback that restores the previous renderer on any failure during the switch.
- Enforce concurrent switch rejection with clear error feedback.

Success criteria:
- Hot-swap completes in under 3 seconds with zero dropped PTY bytes.
- Injected failures during any phase trigger automatic rollback restoring original renderer state.
- Concurrent switch requests are rejected with informative error including transaction status.
- Scrollback, cursor position, environment, and working directory are preserved across hot-swap and rollback.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/013-renderer-switch-transaction/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/013-renderer-switch-transaction/spec.md`
- Switch transaction state machine: `apps/runtime/src/renderer/switch_transaction.ts` (WP01)
- PTY stream proxy: `apps/runtime/src/renderer/pty_stream_proxy.ts` (WP01)
- Capability matrix: `apps/runtime/src/renderer/capability_matrix.ts` (WP01)
- Renderer adapters: specs 010, 011, 012

Constraints:
- All-or-nothing atomicity: all terminals switch or none do.
- Rollback must leave system in identical state to pre-switch.
- Keep files under 500 lines.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement hot-swap execution path
- Purpose: atomically transition all active terminals from source renderer to target renderer using the PTY stream proxy.
- Steps:
  1. Implement `executeHotSwap(transaction, terminals, sourceAdapter, targetAdapter)` in `apps/runtime/src/renderer/hot_swap.ts`.
  2. Phase 1 - Pre-validation:
     a. Query capability matrix to confirm both renderers support hot-swap.
     b. Validate all terminal PTY streams are healthy.
     c. If any check fails, abort before side effects and return error.
  3. Phase 2 - Buffer activation:
     a. Activate PTY stream proxy buffering for all terminals simultaneously.
     b. Transition state machine to `hot-swapping`.
  4. Phase 3 - Renderer swap:
     a. Initialize target renderer adapter for all terminals.
     b. If target init succeeds for all terminals, detach source renderer.
     c. If target init fails for any terminal, trigger rollback (T007).
  5. Phase 4 - Replay and commit:
     a. Replay PTY buffers to the target renderer for each terminal.
     b. Verify all replays complete without errors.
     c. Transition state machine to `committing` then `committed`.
     d. Switch PTY proxies back to passthrough mode with target renderer.
  6. Handle session context preservation: scrollback history, cursor position, env vars, cwd.
  7. Export `executeHotSwap` for use by the switch transaction orchestrator.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/hot_swap.ts`
- Validation:
  - Integration test: hot-swap with 3 active terminals, verify all streams continuous.
  - Integration test: verify scrollback and cursor position match pre-swap state.
  - Timing test: verify completion under 3 seconds with typical terminal count.
- Parallel: No.

### Subtask T007 - Implement rollback logic
- Purpose: restore the previous renderer with full state recovery on any failure during the switch transaction.
- Steps:
  1. Implement `executeRollback(transaction, terminals, originalAdapter)` in `apps/runtime/src/renderer/rollback.ts`.
  2. Rollback sequence:
     a. Transition state machine to `rolling-back`.
     b. Teardown any partially-initialized target renderer instances.
     c. Re-attach the original renderer adapter to all terminals.
     d. Abort PTY stream proxies (discard buffer, restore original passthrough).
     e. Verify all terminal PTY streams are functional with original renderer.
     f. Transition state machine to `rolled-back`.
  3. Emit `renderer.switch.rolled_back` event with failure reason.
  4. Handle partial rollback: if some terminals cannot be restored, flag them as degraded and notify the user.
  5. Preserve complete session context during rollback (scrollback, cursor, env, cwd).
  6. Return rollback result with per-terminal status.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/rollback.ts`
- Validation:
  - Integration test: inject failure during target init, verify rollback restores original state.
  - Integration test: inject failure during replay, verify rollback restores original state.
  - Integration test: verify rollback completes under 5 seconds.
  - Unit test: verify rolled-back event payload includes failure reason.
- Parallel: No.

### Subtask T008 - Implement concurrent switch rejection
- Purpose: prevent multiple switch transactions from running simultaneously, which would corrupt state.
- Steps:
  1. Add a transaction-active guard in the switch transaction module.
  2. When a new switch is requested while a transaction is active:
     a. Return a structured error with `ConcurrentSwitchRejection` type.
     b. Include the active transaction ID, phase, and estimated completion time if available.
  3. Wire the guard into the public `startSwitch()` entry point.
  4. Add terminal creation queueing awareness: new terminals created during a switch are queued (implemented fully in WP03 T013, but the rejection signal is defined here).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/switch_transaction.ts` (guard addition)
- Validation:
  - Unit test: start a transaction, attempt second start, assert rejection error with transaction details.
  - Unit test: after first transaction completes, second start succeeds.
- Parallel: No.

### Subtask T009 - Wire hot-swap and rollback into switch transaction state machine
- Purpose: integrate the hot-swap and rollback execution paths as the primary switch strategy within the transaction orchestrator.
- Steps:
  1. Implement `startSwitch(targetRendererId)` orchestrator function that:
     a. Checks concurrent transaction guard (T008).
     b. Creates a new `SwitchTransaction` in `pending` state.
     c. Queries capability matrix: if `canHotSwap`, call `executeHotSwap` (T006).
     d. On hot-swap failure, call `executeRollback` (T007).
     e. On hot-swap success, transition to `committed`.
     f. If not hot-swap capable, leave a placeholder for restart-with-restore (WP03).
  2. Wire error propagation: all errors from hot-swap and rollback are captured in the transaction record.
  3. Expose the orchestrator as the public API for triggering renderer switches.
  4. Add user notification callback interface for switch progress, success, and failure.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/switch_transaction.ts` (orchestrator integration)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/hot_swap.ts` (wiring)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/rollback.ts` (wiring)
- Validation:
  - Integration test: full happy-path hot-swap through orchestrator.
  - Integration test: hot-swap failure triggers rollback through orchestrator.
  - Integration test: non-hot-swap-capable pair returns placeholder/error until WP03.
- Parallel: No.

### Subtask T010 - Add integration tests for hot-swap, rollback, and concurrent rejection
- Purpose: validate complete hot-swap and rollback flows under realistic conditions.
- Steps:
  1. Create test file `apps/runtime/tests/integration/renderer/hot_swap.test.ts`:
     a. Test hot-swap success with 1, 3, and 5 terminals.
     b. Test PTY byte continuity: write known pattern before swap, verify pattern continuous after.
     c. Test scrollback preservation after swap.
     d. Test cursor position and cwd preservation.
  2. Create test file `apps/runtime/tests/integration/renderer/rollback.test.ts`:
     a. Test rollback on target renderer init failure.
     b. Test rollback on PTY replay failure.
     c. Test rollback restores exact pre-swap terminal state.
     d. Test rollback completes under 5s SLO.
  3. Create test file `apps/runtime/tests/integration/renderer/concurrent_switch.test.ts`:
     a. Test concurrent switch rejection returns correct error.
     b. Test sequential switches succeed.
  4. Use mock renderer adapters that simulate real init/teardown timing.
  5. Aim for >=85% line coverage across hot-swap and rollback modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/renderer/hot_swap.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/renderer/rollback.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/renderer/concurrent_switch.test.ts`
- Parallel: Yes (after T006/T007/T009 are integrated).

## Test Strategy

- Integration tests with mock renderer adapters simulating realistic timing.
- Fault injection via adapter mocks that fail at specific phases.
- Byte-level verification of PTY stream continuity.
- SLO timing assertions at p95 across repeated runs.

## Risks & Mitigations

- Risk: partial renderer attachment creates split state.
- Mitigation: two-phase commit with pre-validation before any detachment.
- Risk: rollback fails to restore original state.
- Mitigation: rollback operates on preserved original adapter references; degraded mode as last resort.

## Review Guidance

- Confirm atomicity: verify that partial hot-swap always triggers rollback.
- Confirm byte-level PTY continuity in test assertions.
- Confirm concurrent rejection returns actionable error details.
- Confirm session context (scrollback, cursor, env, cwd) is preserved in all paths.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:31:19Z – claude-haiku – shell_pid=61191 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:33:38Z – claude-haiku – shell_pid=61191 – lane=done – Implemented: Hot-swap execution (T006), rollback logic (T007), concurrent switch rejection (T008), transaction orchestrator integration (T009), and 21 integration tests (T010). All tests passing.
