---
work_package_id: WP03
title: Context Switch Propagation, Keyboard Shortcuts, and End-to-End Tests
lane: "done"
dependencies:
- WP02
base_branch: 016-workspace-lane-session-ui-tabs-WP02
base_commit: f90602393e7931f79e1b30beb7fc109e342cb183
created_at: '2026-03-01T13:35:32.740579+00:00'
subtasks:
- T012
- T013
- T014
- T015
- T016
phase: Phase 3 - Integration and Hardening
assignee: ''
agent: "claude-haiku"
shell_pid: "80432"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 - Context Switch Propagation, Keyboard Shortcuts, and End-to-End Tests

## Objectives & Success Criteria

- Implement atomic context switch propagation that updates all visible tabs or shows stale indicators.
- Implement configurable keyboard shortcuts for all tab operations.
- Implement stale-context indicator for tabs that fail to update.
- Deliver Playwright end-to-end tests and performance benchmarks.

Success criteria:
- After a lane context switch, all visible tabs reflect the new context within 500ms.
- Keyboard shortcuts navigate all tabs and perform common actions without mouse.
- Failed tab updates display a stale-context indicator rather than hiding the problem.
- Zero mixed-context states across tabs in the test matrix.
- Tab switch latency under 200ms at p95.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/spec.md`
- Tab surfaces: `apps/desktop/src/tabs/` (WP01/WP02)
- Context store: `apps/desktop/src/tabs/context_switch.ts` (WP01)
- Internal event bus: `apps/runtime/src/protocol/bus.ts` (spec 001)

Constraints:
- No mouse-required workflows.
- Keyboard shortcuts must be configurable and persisted.
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP03`

## Subtasks & Detailed Guidance

### Subtask T012 - Implement atomic context switch propagation
- Purpose: ensure all visible tabs update when the active context changes, with stale indicators on failure.
- Steps:
  1. Implement context propagation in `apps/desktop/src/tabs/context_switch.ts`:
     a. On context change, iterate all registered tab surfaces.
     b. Call `onContextChange(newContext)` on each tab.
     c. Track success/failure for each tab.
     d. If all succeed: clear any stale indicators.
     e. If any fail: set stale-context flag on failed tabs, log errors.
  2. Implement propagation timeout:
     a. Each tab has 500ms to complete its context update.
     b. If a tab exceeds the timeout, mark it as stale.
  3. Implement rapid-switch handling:
     a. If a new context change arrives while propagation is in progress, cancel the current propagation.
     b. Start propagation for the new context.
     c. Ensure tabs converge on the final context without rendering intermediates.
  4. FR-016-003: update all visible tabs when active lane/session changes.
  5. FR-016-005: display stale-context indicator on failed tabs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/context_switch.ts`
- Validation:
  - Unit test: change context, verify all tabs receive new context.
  - Unit test: simulate tab update failure, verify stale indicator set.
  - Unit test: rapid context changes, verify tabs converge on final context.
  - Unit test: propagation timeout, verify stale indicator on slow tab.
- Parallel: No.

### Subtask T013 - Implement configurable keyboard shortcuts
- Purpose: enable keyboard-first tab navigation and common actions.
- Steps:
  1. Implement `KeyboardShortcuts` in `apps/desktop/src/tabs/keyboard_shortcuts.ts`:
     a. Define default shortcut map:
        i. `Cmd/Ctrl+1` through `Cmd/Ctrl+5`: switch to terminal, agent, session, chat, project tabs.
        ii. `Cmd/Ctrl+[`: previous tab.
        iii. `Cmd/Ctrl+]`: next tab.
        iv. `Cmd/Ctrl+Shift+T`: focus tab bar.
     b. Implement shortcut registration with the ElectroBun keyboard event system.
     c. Implement shortcut configuration UI (or config file): users can remap shortcuts.
     d. Persist shortcut configuration to `~/.helios/data/keyboard_shortcuts.json`.
  2. Implement focus management:
     a. When a tab is activated via shortcut, focus moves into the tab content.
     b. Tab/Shift-Tab within a tab moves focus between focusable elements.
     c. Escape returns focus to the tab bar.
  3. Implement shortcut conflict detection:
     a. If a user maps a shortcut that conflicts with a system shortcut, warn and reject.
  4. FR-016-004: provide configurable keyboard shortcuts for switching between tabs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/keyboard_shortcuts.ts`
- Validation:
  - Unit test: register default shortcuts, verify each activates the correct tab.
  - Unit test: remap a shortcut, verify new mapping works.
  - Unit test: conflict detection rejects duplicate shortcut.
  - Unit test: persistence: save shortcuts, reload, verify mappings preserved.
- Parallel: No.

### Subtask T014 - Implement stale-context indicator component
- Purpose: visually communicate to the user when a tab's content may be out of date.
- Steps:
  1. Implement stale indicator in the tab bar header:
     a. When a tab's `staleContext` flag is set, display a warning icon/badge on its tab header.
     b. Use a distinct color (yellow/amber) that does not overlap with active/inactive styling.
  2. Implement stale indicator within the tab content:
     a. Display a non-dismissible banner at the top of the tab content: "This tab may show outdated information. Try switching lanes again."
     b. Provide a "Retry" button that re-triggers context propagation for this tab only.
  3. Implement auto-clear:
     a. If a subsequent context change succeeds, clear the stale indicator.
     b. If the retry action succeeds, clear the stale indicator.
  4. Emit `tab.context.stale` event on the bus for monitoring.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/tab_bar.ts` (header indicator)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/tab_surface.ts` (content banner)
- Validation:
  - Unit test: set stale flag, verify warning icon and banner displayed.
  - Unit test: retry succeeds, verify stale indicator cleared.
  - Unit test: subsequent successful context change clears stale.
- Parallel: No.

### Subtask T015 - Add Playwright end-to-end tests
- Purpose: validate the complete tab navigation experience from the user's perspective.
- Steps:
  1. Create `apps/desktop/tests/e2e/tabs/tab_navigation.test.ts`:
     a. Test: open app, verify 5 tabs visible in tab bar.
     b. Test: click each tab, verify content updates.
     c. Test: switch to each tab via keyboard shortcut, verify content.
     d. Test: cycle through tabs with Cmd+[ and Cmd+], verify order.
  2. Create `apps/desktop/tests/e2e/tabs/context_switch.test.ts`:
     a. Test: switch lane, verify all tabs update to new lane content.
     b. Test: rapid lane switches (5 switches in 1 second), verify final state is consistent.
     c. Test: simulate tab update failure, verify stale indicator visible.
  3. Create `apps/desktop/tests/e2e/tabs/keyboard_workflow.test.ts`:
     a. Test: complete full workflow using only keyboard:
        i. Open workspace -> switch to terminal tab -> switch lanes -> view agent output -> open chat.
     b. Test: focus management (Tab/Shift-Tab within tab content, Escape to tab bar).
  4. Capture screenshots for visual regression baseline.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/tabs/tab_navigation.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/tabs/context_switch.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/tabs/keyboard_workflow.test.ts`
- Parallel: Yes (after T012-T014 are integrated).

### Subtask T016 - Add performance benchmarks
- Purpose: validate tab switch latency and context propagation timing SLOs.
- Steps:
  1. Create `apps/desktop/tests/e2e/tabs/performance.test.ts`:
     a. Tab switch benchmark: switch between all 5 tabs 50 times, measure render latency, assert p95 < 200ms.
     b. Context propagation benchmark: trigger 20 lane switches, measure propagation to all tabs, assert p95 < 500ms.
     c. Rapid switch benchmark: 10 lane switches in 2 seconds, measure final convergence time.
  2. Record timing distributions for review.
  3. Verify input latency stays under 100ms during background data loading (NFR-016-003).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/tabs/performance.test.ts`
- Parallel: Yes (after T012-T014 are integrated).

## Test Strategy

- Playwright for full UI interaction and keyboard workflow verification.
- Performance benchmarks with timing assertions at p95.
- Visual regression screenshots at key states.
- Aim for >=85% line coverage across tab modules.

## Risks & Mitigations

- Risk: rapid context switches cause flicker.
- Mitigation: debounced propagation with cancel-on-new-change.
- Risk: keyboard shortcut conflicts with system shortcuts.
- Mitigation: conflict detection and user warning on remap.

## Review Guidance

- Confirm atomic propagation either updates all tabs or shows stale indicators.
- Confirm rapid switch handling converges to final context without intermediate renders.
- Confirm all Playwright tests use only keyboard for keyboard workflow tests.
- Confirm performance benchmarks use sufficient iterations.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:35:33Z – claude-haiku – shell_pid=80432 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:37:09Z – claude-haiku – shell_pid=80432 – lane=done – Implemented WP03
