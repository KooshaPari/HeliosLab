---
work_package_id: WP01
title: Watchdog Scheduler and Three Detectors
lane: "done"
dependencies: []
base_branch: main
base_commit: c36745c15926bc46d62710af10aa4ca1718575b1
created_at: '2026-03-01T13:29:36.317013+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - Detection Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "54633"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Watchdog Scheduler and Three Detectors

## Objectives & Success Criteria

- Implement a periodic watchdog that runs orphan detection cycles at a configurable interval.
- Implement three specialized detectors: orphaned worktree, stale zellij session, and leaked PTY process.
- Implement resource classification with type, age, estimated owning lane, and risk level.
- Implement checkpoint persistence for crash recovery.

Success criteria:
- 100% of intentionally orphaned resources are detected within two watchdog cycles.
- Zero false positives on a healthy system with all lanes active.
- Detection cycle completes in under 2 seconds for 100 lanes.
- After simulated crash, watchdog resumes from the last checkpoint.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/015-lane-orphan-detection-and-remediation/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/015-lane-orphan-detection-and-remediation/spec.md`
- Lane lifecycle: spec 008
- Session lifecycle: spec 009
- Filesystem APIs for worktree enumeration
- Process-table APIs for PTY process enumeration
- zellij CLI for session listing

Constraints:
- Watchdog must not consume more than 1% CPU on average during idle.
- Detection only; no automatic cleanup (remediation is WP02).
- Keep files under 500 lines.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement watchdog scheduler with checkpoint persistence
- Purpose: run periodic detection cycles and persist state for crash recovery.
- Steps:
  1. Implement `OrphanWatchdog` in `apps/runtime/src/lanes/watchdog/orphan_watchdog.ts`:
     a. Accept configurable `detectionInterval` (default: 60 seconds).
     b. Implement `start()` to begin the periodic detection loop using `setInterval` or `setTimeout` chain.
     c. Implement `stop()` to cleanly halt the loop.
     d. On each cycle: run all three detectors, collect results, classify resources, store results.
     e. After each cycle: update checkpoint with cycle timestamp and summary.
  2. Implement `WatchdogCheckpoint` in `apps/runtime/src/lanes/watchdog/checkpoint.ts`:
     a. Persist: last cycle timestamp, cycle number, detected orphan count, detection results summary.
     b. Storage: file-backed JSON at `~/.helios/data/watchdog_checkpoint.json`.
     c. `save(checkpoint)`: write to disk.
     d. `load(): WatchdogCheckpoint | null`: read from disk; return null if missing or corrupt.
  3. Implement crash recovery:
     a. On `start()`, load checkpoint. If present, log resume information and continue from last cycle number.
     b. If checkpoint is corrupt or missing, start fresh with cycle 0.
  4. Implement CPU-awareness: measure cycle duration and log warnings if cycles exceed 2 seconds.
  5. Export the watchdog class for lifecycle management.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/orphan_watchdog.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/checkpoint.ts`
- Validation:
  - Unit test: start watchdog with short interval (100ms), verify detection cycles run.
  - Unit test: stop watchdog, verify no further cycles.
  - Unit test: save checkpoint, reload, assert values match.
  - Unit test: simulate corrupt checkpoint file, assert fresh start.
- Parallel: No.

### Subtask T002 - Implement orphaned worktree detector
- Purpose: detect git worktrees on disk that have no corresponding active lane in the registry.
- Steps:
  1. Implement `WorktreeDetector` in `apps/runtime/src/lanes/watchdog/worktree_detector.ts`:
     a. Accept a worktree base directory path and a lane registry query interface as dependencies.
     b. `detect(): OrphanedResource[]`:
        i. Enumerate all git worktrees under the base directory (use `git worktree list --porcelain` or filesystem scan).
        ii. For each worktree, extract its lane identifier (from directory naming convention or metadata file).
        iii. Cross-reference against the lane registry: if no active lane matches, classify as orphaned.
        iv. Record: worktree path, detected lane ID (if determinable), creation time (from filesystem), age.
  2. Handle edge cases:
     a. Worktree with no identifiable lane: classify as orphaned with `unknown` owning lane.
     b. Worktree whose lane is in `cleaning` state: do NOT classify as orphaned (transient state).
     c. Worktree whose lane is in `recovering` state: do NOT classify as orphaned.
  3. Return structured `OrphanedResource` objects with type `worktree`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/worktree_detector.ts`
- Validation:
  - Unit test: mock filesystem with 3 worktrees (2 active, 1 orphaned), verify only orphan detected.
  - Unit test: worktree with lane in `cleaning` state, verify NOT detected as orphan.
  - Unit test: worktree with no identifiable lane, verify detected with `unknown` owner.
- Parallel: No.

### Subtask T003 - Implement stale zellij session detector
- Purpose: detect zellij sessions that have no corresponding active lane or session binding.
- Steps:
  1. Implement `ZellijDetector` in `apps/runtime/src/lanes/watchdog/zellij_detector.ts`:
     a. Accept a session registry query interface as dependency.
     b. `detect(): OrphanedResource[]`:
        i. List all zellij sessions (use `zellij list-sessions` CLI or equivalent API).
        ii. Parse session names/IDs to extract lane/session identifiers.
        iii. Cross-reference against the session registry: if no active session matches, classify as stale.
        iv. Record: zellij session name, detected session/lane ID, creation time, age.
  2. Handle edge cases:
     a. Zellij session with unrecognizable name: classify as orphaned with `unknown` owner.
     b. Zellij session whose lane is recovering: do NOT classify as orphaned.
  3. Return structured `OrphanedResource` objects with type `zellij_session`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/zellij_detector.ts`
- Validation:
  - Unit test: mock zellij session list with 2 active + 1 stale, verify only stale detected.
  - Unit test: zellij session with recovering lane, verify NOT detected.
  - Unit test: unrecognizable session name, verify detected with `unknown` owner.
- Parallel: No.

### Subtask T004 - Implement leaked PTY process detector
- Purpose: detect PTY-attached processes that have no parent lane or session ownership.
- Steps:
  1. Implement `PtyDetector` in `apps/runtime/src/lanes/watchdog/pty_detector.ts`:
     a. Accept a terminal registry query interface as dependency.
     b. `detect(): OrphanedResource[]`:
        i. Enumerate PTY-attached processes (use platform-specific APIs: `ps` command with PTY filter on macOS/Linux).
        ii. For each PTY process, determine its PID and associated terminal.
        iii. Cross-reference against the terminal registry: if no terminal binding exists for this PTY, classify as leaked.
        iv. Record: PID, PTY device, detected terminal/lane ID, process age.
  2. Handle edge cases:
     a. System PTY processes (not owned by Helios): filter by known process group or parent PID chain.
     b. PTY processes that were just spawned (within last 5 seconds): skip to avoid race conditions.
  3. Return structured `OrphanedResource` objects with type `pty_process`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/pty_detector.ts`
- Validation:
  - Unit test: mock process table with 3 PTY processes (2 bound, 1 leaked), verify only leaked detected.
  - Unit test: system PTY process not owned by Helios, verify NOT detected.
  - Unit test: recently spawned PTY (< 5s), verify NOT detected (grace period).
- Parallel: No.

### Subtask T005 - Implement resource classifier
- Purpose: classify each orphaned resource by type, age, estimated owning lane, and risk level.
- Steps:
  1. Implement `ResourceClassifier` in `apps/runtime/src/lanes/watchdog/resource_classifier.ts`:
     a. Accept an `OrphanedResource` and produce a `ClassifiedOrphan`:
        i. `type`: `worktree` | `zellij_session` | `pty_process`.
        ii. `age`: duration since resource creation (from filesystem/process metadata).
        iii. `estimatedOwner`: lane ID if determinable, `unknown` otherwise.
        iv. `riskLevel`: `low` (age < 1 hour, known owner) | `medium` (age 1-24 hours) | `high` (age > 24 hours or unknown owner).
     b. Risk level calculation should consider both age and ownership confidence.
  2. Implement classification summary:
     a. `classifyAll(resources: OrphanedResource[]): ClassifiedOrphan[]`.
     b. Sort by risk level (high first) for presentation.
  3. Export types and classifier for use by remediation (WP02) and UI.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/lanes/watchdog/resource_classifier.ts`
- Validation:
  - Unit test: classify resource aged 30 minutes with known owner, assert `low` risk.
  - Unit test: classify resource aged 12 hours with known owner, assert `medium` risk.
  - Unit test: classify resource aged 2 days with unknown owner, assert `high` risk.
  - Unit test: classifyAll sorts by risk level descending.
- Parallel: No.

### Subtask T006 - Add unit tests for detectors, classifier, and checkpoint
- Purpose: lock detection behavior and validate false-positive rate.
- Steps:
  1. Create `apps/runtime/tests/unit/lanes/watchdog/orphan_watchdog.test.ts`:
     a. Test scheduler starts, runs cycles, stops cleanly.
     b. Test checkpoint save/load/corrupt recovery.
  2. Create `apps/runtime/tests/unit/lanes/watchdog/worktree_detector.test.ts`:
     a. Test detection with mixed active/orphaned worktrees.
     b. Test transient state exclusion (cleaning, recovering).
     c. Test unknown owner classification.
  3. Create `apps/runtime/tests/unit/lanes/watchdog/zellij_detector.test.ts`:
     a. Test detection with mixed active/stale sessions.
     b. Test recovery-aware exclusion.
  4. Create `apps/runtime/tests/unit/lanes/watchdog/pty_detector.test.ts`:
     a. Test detection with mixed bound/leaked processes.
     b. Test system process filtering.
     c. Test grace period for recently spawned processes.
  5. Create `apps/runtime/tests/unit/lanes/watchdog/resource_classifier.test.ts`:
     a. Test risk level calculations across age/owner combinations.
     b. Test sorting behavior.
  6. False-positive validation:
     a. Create a healthy system mock with all resources bound.
     b. Run all detectors 100 times and assert zero false positives.
  7. Aim for >=90% line coverage on watchdog modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/lanes/watchdog/orphan_watchdog.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/lanes/watchdog/worktree_detector.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/lanes/watchdog/zellij_detector.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/lanes/watchdog/pty_detector.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/lanes/watchdog/resource_classifier.test.ts`
- Parallel: Yes (after T001-T005 interfaces are stable).

## Test Strategy

- Unit tests with mocked filesystem, process table, and zellij CLI.
- False-positive rate validation with healthy system mocks.
- Checkpoint crash recovery simulation.
- Aim for >=90% line coverage.

## Risks & Mitigations

- Risk: race condition between detection and lane creation causes false positive.
- Mitigation: grace periods and two-cycle confirmation before reporting.
- Risk: platform-specific process enumeration differs between macOS and Linux.
- Mitigation: abstract process enumeration behind a platform adapter interface.

## Review Guidance

- Confirm each detector correctly cross-references against the active lane/session registry.
- Confirm transient state exclusion (cleaning, recovering) prevents false positives.
- Confirm resource classifier risk levels match spec requirements.
- Confirm checkpoint persistence handles corrupt files gracefully.
- Confirm false-positive validation runs sufficient iterations.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:37Z – claude-haiku – shell_pid=54633 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:32:23Z – claude-haiku – shell_pid=54633 – lane=done – Implemented watchdog scheduler and detectors
