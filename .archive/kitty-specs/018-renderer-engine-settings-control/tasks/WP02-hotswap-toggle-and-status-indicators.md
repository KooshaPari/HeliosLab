---
work_package_id: WP02
title: Hot-Swap Toggle, Status Indicators, and Tests
lane: "done"
dependencies:
- WP01
base_branch: 018-renderer-engine-settings-control-WP01
base_commit: 8663047c1750d2b636db06c3c9aa41be2ba72918
created_at: '2026-03-01T13:36:36.576698+00:00'
subtasks:
- T007
- T008
- T009
- T010
- T011
phase: Phase 2 - Interaction and Hardening
assignee: ''
agent: "claude-haiku"
shell_pid: "84824"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Hot-Swap Toggle, Status Indicators, and Tests

## Objectives & Success Criteria

- Implement the hot-swap preference toggle that controls switch behavior.
- Implement real-time switch status indicators showing transaction progress.
- Implement settings lock during active switch transactions.
- Wire the hot-swap preference into the switch transaction trigger.
- Deliver Playwright end-to-end tests and performance benchmarks.

Success criteria:
- Hot-swap toggle persists and affects switch behavior (hot-swap vs restart-with-restore).
- Status indicators update within 500ms of transaction phase changes.
- Settings section is locked (non-editable) during active switch transactions.
- All Playwright tests pass including settings lock verification.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/018-renderer-engine-settings-control/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/018-renderer-engine-settings-control/spec.md`
- Settings panel: `apps/desktop/src/settings/` (WP01)
- Renderer preferences: `apps/desktop/src/settings/renderer_preferences.ts` (WP01)
- Switch transaction: spec 013 (`apps/runtime/src/renderer/switch_transaction.ts`)
- Internal event bus: `apps/runtime/src/protocol/bus.ts`

Constraints:
- Settings must be locked during active transactions (FR-018-008).
- Status updates within 500ms of phase changes (NFR-018-002).
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T007 - Implement hot-swap preference toggle
- Purpose: allow users to control whether hot-swap or restart-with-restore is preferred.
- Steps:
  1. Implement `HotSwapToggle` in `apps/desktop/src/settings/hotswap_toggle.ts`:
     a. Display a toggle switch with label: "Prefer hot-swap when available".
     b. Default: enabled (hot-swap preferred).
     c. When disabled: label changes to "Always use restart-with-restore".
     d. On toggle change: save preference via `RendererPreferences` (WP01 T005).
  2. Implement tooltip explaining the tradeoff:
     a. Hot-swap enabled: "Faster switch (~3s) when supported by both renderers."
     b. Hot-swap disabled: "Slower but more reliable switch (~8s) via full restart."
  3. Position the toggle below the renderer options in the settings section.
  4. FR-018-006: provide hot-swap preference toggle.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/hotswap_toggle.ts`
- Validation:
  - Unit test: toggle on, verify preference saved as `hotSwapEnabled: true`.
  - Unit test: toggle off, verify preference saved as `hotSwapEnabled: false`.
  - Unit test: verify tooltip changes based on toggle state.
  - Unit test: verify default is enabled.
- Parallel: No.

### Subtask T008 - Implement real-time switch status indicator
- Purpose: show transaction progress during a renderer switch so users know what is happening.
- Steps:
  1. Implement `SwitchStatus` in `apps/desktop/src/settings/switch_status.ts`:
     a. Subscribe to switch transaction events on the internal bus:
        i. `renderer.switch.started` -> show "Switching renderer..." with progress indicator.
        ii. Phase updates: show current phase (initializing, swapping/restarting, committing).
        iii. `renderer.switch.committed` -> show "Switch successful" (green) for 5 seconds, then clear.
        iv. `renderer.switch.rolled_back` -> show "Switch failed, rolled back" (amber) with failure reason.
        v. `renderer.switch.failed` -> show "Switch failed" (red) with failure details.
     b. Display as a status bar within the renderer settings section.
  2. Implement progress visualization:
     a. Animated progress bar or phase indicator (e.g., dots/steps).
     b. Show elapsed time during the transaction.
  3. Implement timeout handling:
     a. If no event received for 15 seconds during an active transaction, show "Status unknown" warning.
  4. FR-018-005: display real-time status indicators during switch transactions.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/switch_status.ts`
- Validation:
  - Unit test: emit switch.started, verify progress indicator shown.
  - Unit test: emit switch.committed, verify success message shown.
  - Unit test: emit switch.rolled_back, verify failure message with reason.
  - Unit test: simulate event timeout, verify "Status unknown" warning.
  - Unit test: verify status updates within 500ms of event emission.
- Parallel: No.

### Subtask T009 - Implement settings lock during active transactions
- Purpose: prevent settings changes during an active switch to avoid inconsistent state.
- Steps:
  1. Implement `SettingsLock` in `apps/desktop/src/settings/settings_lock.ts`:
     a. Subscribe to switch transaction events.
     b. On `renderer.switch.started`: lock the renderer settings section.
        i. Disable all renderer option selection.
        ii. Disable hot-swap toggle.
        iii. Apply visual overlay or grayed-out styling.
        iv. Show tooltip on locked elements: "Settings locked during renderer switch."
     c. On `renderer.switch.committed` or `renderer.switch.rolled_back` or `renderer.switch.failed`: unlock.
  2. Implement lock state management:
     a. Track lock state as a boolean.
     b. Wire lock state into all interactive elements in the settings section.
  3. Handle edge case: if lock persists beyond 30 seconds (transaction timeout), auto-unlock with warning.
  4. FR-018-008: lock settings during active switch transaction.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/settings_lock.ts`
- Validation:
  - Unit test: emit switch.started, verify all settings inputs disabled.
  - Unit test: emit switch.committed, verify settings unlocked.
  - Unit test: attempt to change renderer during lock, verify rejection.
  - Unit test: lock timeout (30s), verify auto-unlock with warning.
- Parallel: No.

### Subtask T010 - Wire hot-swap preference into switch transaction trigger
- Purpose: make the hot-swap toggle actually affect which switch path is used.
- Steps:
  1. Modify the switch trigger in `apps/desktop/src/settings/switch_confirmation.ts`:
     a. Before triggering `startSwitch`, read the hot-swap preference from `RendererPreferences`.
     b. If `hotSwapEnabled: false`, pass an override flag to the switch transaction: `forceRestartRestore: true`.
     c. The switch transaction (spec 013) respects this flag: even if both renderers support hot-swap, use restart-with-restore when `forceRestartRestore` is true.
  2. Update confirmation dialog messaging:
     a. If hot-swap disabled but both renderers support it: "Hot-swap is available but disabled by preference. Restart-with-restore will be used."
  3. Integrate with the capability matrix:
     a. The confirmation dialog should show the actual switch method that will be used, considering both capability and preference.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/switch_confirmation.ts` (preference integration)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/switch_transaction.ts` (forceRestartRestore flag)
- Validation:
  - Integration test: hot-swap enabled + capable renderers -> hot-swap used.
  - Integration test: hot-swap disabled + capable renderers -> restart-with-restore used.
  - Integration test: hot-swap enabled + incapable renderers -> restart-with-restore used.
  - Unit test: confirmation dialog message reflects actual switch method.
- Parallel: No.

### Subtask T011 - Add Playwright end-to-end tests and performance benchmarks
- Purpose: validate the complete renderer settings experience.
- Steps:
  1. Create `apps/desktop/tests/e2e/settings/renderer_settings.test.ts`:
     a. Test: open settings, verify renderer section visible with both renderers.
     b. Test: expand capability display, verify capabilities shown.
     c. Test: select different renderer, verify confirmation dialog.
     d. Test: confirm switch, verify status indicator shows progress.
     e. Test: verify active renderer indicator updates after successful switch.
  2. Create `apps/desktop/tests/e2e/settings/renderer_preferences.test.ts`:
     a. Test: change renderer preference, restart app, verify preference persisted.
     b. Test: toggle hot-swap, restart app, verify toggle state persisted.
  3. Create `apps/desktop/tests/e2e/settings/renderer_lock.test.ts`:
     a. Test: trigger switch, verify settings locked during transaction.
     b. Test: switch completes, verify settings unlocked.
     c. Test: attempt to change settings during lock, verify rejection.
  4. Create `apps/desktop/tests/e2e/settings/renderer_performance.test.ts`:
     a. Render settings section, measure time, assert < 200ms.
     b. Trigger switch, measure status indicator update latency, assert < 500ms from event.
     c. Load preferences on startup, measure time, assert < 100ms.
  5. Capture screenshots for visual regression baseline.
  6. Aim for >=85% line coverage across settings modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/settings/renderer_settings.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/settings/renderer_preferences.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/settings/renderer_lock.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/settings/renderer_performance.test.ts`
- Parallel: Yes (after T007-T010 are integrated).

## Test Strategy

- Playwright for full UI interactions and lock verification.
- Performance benchmarks for render, status update, and preference load timing.
- Preference persistence tests across simulated restarts.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: status indicator out of sync with transaction state.
- Mitigation: timeout to "unknown" state if events stop.
- Risk: settings lock not released after transaction edge case.
- Mitigation: auto-unlock timeout with warning.

## Review Guidance

- Confirm hot-swap toggle actually affects switch behavior (not just UI).
- Confirm status indicators update for all transaction phases including failure.
- Confirm settings lock covers all interactive elements.
- Confirm auto-unlock timeout prevents permanent lock state.
- Confirm Playwright tests verify lock during simulated transactions.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:36:36Z – claude-haiku – shell_pid=84824 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:37:52Z – claude-haiku – shell_pid=84824 – lane=done – Implemented
