---
work_package_id: WP02
title: Remediation UI, Recovery Suppression, and Tests
lane: "done"
dependencies:
- WP01
base_branch: 015-lane-orphan-detection-and-remediation-WP01
base_commit: f89fa0e1acc75074dedcfee0d26f175325c18ba1
created_at: '2026-03-01T13:32:33.216956+00:00'
subtasks:
- T007
- T008
- T009
- T010
- T011
phase: Phase 2 - Remediation and Hardening
assignee: ''
agent: "claude-haiku"
shell_pid: "67031"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Remediation UI, Recovery Suppression, and Tests

## Objectives & Success Criteria

- Implement user-facing remediation suggestions with confirmation gates (no automatic cleanup).
- Implement cleanup actions: worktree metadata snapshot + deletion, graceful PTY termination, zellij session kill.
- Implement recovery-aware suppression and declined-cleanup cooldown.
- Emit detection and remediation lifecycle events on the internal bus.
- Deliver comprehensive integration tests including false-positive rate validation.

Success criteria:
- Zero resources cleaned up without explicit user confirmation.
- Cleanup suggestions suppressed for resources involved in active recovery.
- Declined cleanups enter cooldown and are not re-suggested until cooldown expires.
- Cleanup failures are reported and skipped without halting remaining actions.
- False-positive rate below 1% across 500+ detection cycles.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/015-lane-orphan-detection-and-remediation/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/015-lane-orphan-detection-and-remediation/spec.md`
- Watchdog and detectors: `apps/runtime/src/lanes/watchdog/` (WP01)
- Resource classifier: `apps/runtime/src/lanes/watchdog/resource_classifier.ts` (WP01)
- Internal event bus: `apps/runtime/src/protocol/bus.ts` (spec 001)

Constraints:
- Never execute cleanup without user confirmation.
- Keep files under 500 lines.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T007 - Implement remediation suggestion engine with confirmation gates
- Purpose: present cleanup suggestions to the user and require explicit confirmation before any action.
- Steps:
  1. Implement `RemediationEngine` in `apps/runtime/src/lanes/watchdog/remediation.ts`:
     a. Accept classified orphan list from the watchdog cycle.
     b. Generate `RemediationSuggestion` objects:
        i. Resource details (type, path/PID, age, risk level, estimated owner).
        ii. Suggested action (delete worktree, kill zellij session, terminate PTY process).
        iii. Confirmation requirement flag (always true in slice-1).
     c. Expose `getSuggestions(): RemediationSuggestion[]` for the UI to display.
     d. Expose `confirmCleanup(suggestionId): Promise<CleanupResult>` that executes only after confirmation.
     e. Expose `declineCleanup(suggestionId): void` that marks the resource for cooldown.
  2. Implement suggestion lifecycle:
     a. New suggestions are created after each watchdog cycle.
     b. Confirmed suggestions trigger cleanup execution (T008).
     c. Declined suggestions enter cooldown (T009).
     d. Stale suggestions (resource no longer orphaned) are auto-removed.
  3. Return structured results for each cleanup attempt (success, failure with reason).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/remediation.ts`
- Validation:
  - Unit test: generate suggestions from classified orphans, verify all have confirmation required.
  - Unit test: confirm cleanup, verify action executed.
  - Unit test: decline cleanup, verify cooldown applied.
  - Unit test: verify no cleanup executes without explicit `confirmCleanup` call.
- Parallel: No.

### Subtask T008 - Implement cleanup actions
- Purpose: execute safe cleanup for each resource type after user confirmation.
- Steps:
  1. Implement worktree cleanup in `apps/runtime/src/lanes/watchdog/remediation.ts` or a sub-module:
     a. Before deletion: take a lightweight metadata snapshot (branch, HEAD commit, modified files list) and store in `~/.helios/data/worktree_snapshots/`.
     b. Delete the worktree directory using `git worktree remove` or filesystem removal.
     c. Retain snapshot for a configurable retention period (default: 7 days).
  2. Implement PTY process cleanup:
     a. Send SIGTERM to the process.
     b. Wait up to 5 seconds for graceful exit.
     c. If still alive, send SIGKILL.
     d. Record termination result.
  3. Implement zellij session cleanup:
     a. Kill the zellij session using `zellij kill-session <name>`.
     b. Verify session is no longer listed.
  4. Handle cleanup failures:
     a. If any cleanup fails (e.g., permission denied), record the failure reason.
     b. Skip the failed resource and continue with remaining cleanups.
     c. Return per-resource results to the caller.
  5. All cleanup actions must be idempotent (safe to retry).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/remediation.ts`
- Validation:
  - Integration test: create orphaned worktree, confirm cleanup, verify worktree removed and snapshot saved.
  - Integration test: spawn orphaned PTY process, confirm cleanup, verify process terminated.
  - Unit test: simulate cleanup failure, verify skip + error reporting.
  - Unit test: verify snapshot retention creates recoverable metadata.
- Parallel: No.

### Subtask T009 - Implement recovery-aware suppression and declined-cleanup cooldown
- Purpose: prevent false cleanup suggestions for recovering resources and honor user decline decisions.
- Steps:
  1. Implement recovery-aware suppression:
     a. Before generating suggestions, cross-reference orphan candidates against active recovery operations.
     b. Query the lane/session registry for lanes in `recovering` state.
     c. Exclude any orphan whose estimated owner is a recovering lane.
     d. Log suppression decisions for debugging.
  2. Implement declined-cleanup cooldown:
     a. Maintain a cooldown map: `Map<resourceKey, cooldownExpiresAt>`.
     b. When `declineCleanup` is called, add resource to cooldown with configurable duration (default: 24 hours).
     c. During suggestion generation, exclude resources in active cooldown.
     d. Persist cooldown map to disk for restart survival.
  3. Implement cooldown expiry: remove expired entries on each detection cycle.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/remediation.ts`
- Validation:
  - Unit test: orphan with recovering lane owner, verify suppressed from suggestions.
  - Unit test: decline cleanup, verify resource excluded from next cycle suggestions.
  - Unit test: cooldown expires, verify resource re-appears in suggestions.
  - Integration test: persist cooldown, restart, verify cooldown still active.
- Parallel: No.

### Subtask T010 - Wire detection and remediation events on the internal bus
- Purpose: enable downstream consumers (UI, audit, monitoring) to react to orphan detection and remediation actions.
- Steps:
  1. Define event topics:
     a. `orphan.detection.cycle_completed`: emitted after each watchdog cycle with summary.
     b. `orphan.detection.resource_found`: emitted for each newly detected orphan.
     c. `orphan.remediation.suggested`: emitted when suggestions are generated.
     d. `orphan.remediation.confirmed`: emitted when user confirms a cleanup.
     e. `orphan.remediation.completed`: emitted after cleanup execution (success or failure).
     f. `orphan.remediation.declined`: emitted when user declines a cleanup.
  2. Define event payloads with resource details, action, result, and correlation IDs.
  3. Wire events into the watchdog, remediation engine, and cleanup actions.
  4. Register topics in the protocol topic registry.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/orphan_watchdog.ts` (cycle events)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/remediation.ts` (remediation events)
- Validation:
  - Unit test: run detection cycle, verify `cycle_completed` event emitted with correct counts.
  - Unit test: confirm cleanup, verify `confirmed` and `completed` events emitted.
  - Unit test: decline cleanup, verify `declined` event emitted.
- Parallel: No.

### Subtask T011 - Add integration tests
- Purpose: validate the complete orphan detection and remediation workflow under realistic conditions.
- Steps:
  1. Create `apps/runtime/tests/integration/lanes/watchdog/detection_accuracy.test.ts`:
     a. Create a mixed environment with active lanes, orphaned worktrees, stale zellij sessions, and leaked PTY processes.
     b. Run 2 watchdog cycles and verify all orphans detected with correct classification.
     c. Verify no false positives for active resources.
  2. Create `apps/runtime/tests/integration/lanes/watchdog/remediation_workflow.test.ts`:
     a. Test full workflow: detect -> suggest -> confirm -> cleanup for each resource type.
     b. Test decline -> cooldown -> re-detection after cooldown expires.
     c. Test cleanup failure handling: inject permission error, verify skip + continue.
  3. Create `apps/runtime/tests/integration/lanes/watchdog/recovery_suppression.test.ts`:
     a. Create orphan whose lane is recovering, verify suppressed.
     b. Complete recovery, verify orphan detected on next cycle.
  4. Create `apps/runtime/tests/integration/lanes/watchdog/false_positive_rate.test.ts`:
     a. Create healthy system with 50 active lanes and no orphans.
     b. Run 500+ detection cycles.
     c. Assert zero false positives (or <1% rate).
  5. Create `apps/runtime/tests/integration/lanes/watchdog/performance.test.ts`:
     a. Create 100 lane mock environment with 20 orphans.
     b. Measure detection cycle time, assert <2 seconds.
  6. Aim for >=85% line coverage across all watchdog modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/lanes/watchdog/detection_accuracy.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/lanes/watchdog/remediation_workflow.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/lanes/watchdog/recovery_suppression.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/lanes/watchdog/false_positive_rate.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/lanes/watchdog/performance.test.ts`
- Parallel: Yes (after T007-T010 are implemented).

## Test Strategy

- Integration tests with simulated orphan environments.
- False-positive rate validation across 500+ detection cycles.
- Performance benchmarks for detection cycle timing.
- Cleanup verification with real filesystem and process operations (in test sandbox).
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: cleanup of recovering resource due to race condition.
- Mitigation: recovery-aware suppression and two-cycle confirmation requirement.
- Risk: cooldown map grows unbounded.
- Mitigation: expire and prune entries on each cycle.

## Review Guidance

- Confirm no cleanup path executes without explicit user confirmation.
- Confirm recovery-aware suppression cross-references current lane/session state.
- Confirm cooldown persistence survives restart.
- Confirm cleanup failures are handled gracefully (skip + continue).
- Confirm false-positive rate test uses sufficient iterations.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:32:33Z – claude-haiku – shell_pid=67031 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:21Z – claude-haiku – shell_pid=67031 – lane=done – Implemented remediation engine and integration tests
