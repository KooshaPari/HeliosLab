---
work_package_id: WP02
title: CRUD Actions, Real-Time Updates, and Tests
lane: "done"
dependencies:
- WP01
base_branch: 017-lane-list-and-status-display-WP01
base_commit: c87845d6c6938059f4f9500d33801e971be90a5b
created_at: '2026-03-01T13:32:45.065445+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
- T011
phase: Phase 2 - Interaction and Hardening
assignee: ''
agent: "claude-haiku"
shell_pid: "68186"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - CRUD Actions, Real-Time Updates, and Tests

## Objectives & Success Criteria

- Implement lane CRUD actions (create, attach, detach, cleanup) accessible from the panel.
- Implement confirmation dialog for destructive actions.
- Implement real-time status badge updates via bus event subscription.
- Integrate orphan detection flags and stale-status indicators.
- Deliver Playwright tests and performance benchmarks.

Success criteria:
- Lane create/attach/detach/cleanup actions execute successfully from the panel.
- Cleanup requires confirmation dialog before execution; no cleanup without confirmation.
- Status badges update within 1 second of bus events.
- Orphaned lanes display a distinct visual indicator.
- Bus connectivity loss shows "status may be stale" indicator.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/017-lane-list-and-status-display/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/017-lane-list-and-status-display/spec.md`
- Lane panel: `apps/desktop/src/panels/` (WP01)
- Lane lifecycle API: spec 008
- Orphan detection: spec 015
- Internal event bus: `apps/runtime/src/protocol/bus.ts` (spec 001)

Constraints:
- Cleanup requires confirmation (FR-017-004).
- Updates must not block main UI thread.
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement lane action handlers
- Purpose: enable lane management operations from the panel UI.
- Steps:
  1. Implement `LaneActions` in `apps/desktop/src/panels/lane_actions.ts`:
     a. `createLane(workspaceId)`: call runtime API to create a new lane with default name. Update panel on success.
     b. `attachLane(laneId)`: call runtime API to attach to the lane. Trigger context switch to the attached lane. Update all tabs (spec 016 integration).
     c. `detachLane(laneId)`: call runtime API to detach from the lane. Clear active context if this was the active lane.
     d. `cleanupLane(laneId)`: show confirmation dialog (T007). On confirm, call runtime API to clean up. On decline, do nothing.
  2. Implement error handling:
     a. Display inline error message in the panel if an action fails.
     b. Log error details for debugging.
     c. Auto-dismiss error after 10 seconds or on user action.
  3. Implement optimistic UI:
     a. On create: immediately add a "provisioning" lane to the list before API response.
     b. On attach: immediately highlight the lane before API confirmation.
     c. On failure: revert optimistic update and show error.
  4. Wire actions into `LaneListItem` click/menu handlers and keyboard navigation.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_actions.ts`
- Validation:
  - Unit test: create lane, verify provisioning item appears, then confirm via API mock.
  - Unit test: attach lane, verify context switch triggered.
  - Unit test: cleanup lane without confirmation, verify action NOT executed.
  - Unit test: action failure, verify error message displayed and optimistic update reverted.
- Parallel: No.

### Subtask T007 - Implement confirmation dialog
- Purpose: require explicit user confirmation before destructive actions (cleanup).
- Steps:
  1. Implement `ConfirmationDialog` in `apps/desktop/src/panels/confirmation_dialog.ts`:
     a. Accept: title, message, confirm label, cancel label, and callback.
     b. Display modal dialog with clear warning about the action's consequences.
     c. For cleanup: include lane name, current state, and resource details.
     d. Confirm button calls the action callback; cancel dismisses the dialog.
  2. Implement keyboard accessibility:
     a. Escape dismisses the dialog.
     b. Enter confirms the action.
     c. Tab moves between confirm and cancel buttons.
     d. Focus is trapped within the dialog while open.
  3. Implement dialog animation: brief fade-in to avoid jarring appearance.
  4. FR-017-004: cleanup actions require user confirmation.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/confirmation_dialog.ts`
- Validation:
  - Unit test: open dialog, press confirm, verify callback called.
  - Unit test: open dialog, press cancel, verify callback NOT called.
  - Unit test: press Escape, verify dialog dismissed.
  - Unit test: verify focus trap within dialog.
- Parallel: No.

### Subtask T008 - Implement real-time bus event subscription
- Purpose: update lane status badges in real time based on lifecycle events.
- Steps:
  1. Implement `LaneEventHandler` in `apps/desktop/src/panels/lane_event_handler.ts`:
     a. Subscribe to lane lifecycle events on the internal bus:
        i. `lane.state.changed`: update the badge for the affected lane.
        ii. `lane.created`: add a new lane to the list.
        iii. `lane.cleaned_up` / `lane.closed`: remove the lane from the list or show closed badge.
     b. On each event, update the corresponding `LaneListItem` in the panel.
  2. Implement debouncing:
     a. If rapid state transitions arrive for the same lane, only render the final state.
     b. Use `requestAnimationFrame` batching to avoid excessive re-renders.
  3. Implement event ordering:
     a. Process events in sequence number order if available.
     b. Discard out-of-order events that would revert to a previous state.
  4. Wire event handler into the lane panel lifecycle (subscribe on mount, unsubscribe on unmount).
  5. FR-017-005: update lane status badges in real time via bus events.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_event_handler.ts`
- Validation:
  - Unit test: emit state change event, verify badge updates.
  - Unit test: emit lane.created, verify new lane appears.
  - Unit test: emit lane.cleaned_up, verify lane removed/closed.
  - Unit test: rapid events for same lane, verify only final state rendered.
- Parallel: No.

### Subtask T009 - Implement orphan detection integration
- Purpose: flag orphaned lanes with a distinct visual indicator in the panel.
- Steps:
  1. Query spec 015 orphan detection API for the list of orphaned lanes:
     a. On panel mount and after each detection cycle event, refresh the orphan list.
     b. Cross-reference orphan list with the lane list.
  2. For each orphaned lane:
     a. Add an orphan flag to the `LaneListItem`.
     b. Display a distinct warning icon (orange triangle or similar) next to the status badge.
     c. Add "Orphaned" to the tooltip with remediation suggestion.
  3. Subscribe to `orphan.detection.cycle_completed` events to refresh the orphan list.
  4. FR-017-006: integrate with orphan detection to flag orphaned lanes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_event_handler.ts` (orphan subscription)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_list_item.ts` (orphan display)
- Validation:
  - Unit test: lane flagged as orphaned, verify warning icon displayed.
  - Unit test: lane orphan status cleared, verify warning icon removed.
  - Unit test: orphan detection cycle event, verify list refreshed.
- Parallel: No.

### Subtask T010 - Implement stale-status indicator
- Purpose: warn users when lane status may be outdated due to bus connectivity issues.
- Steps:
  1. Monitor bus connectivity:
     a. If no bus events received for a configurable timeout (default: 30 seconds), display a banner.
     b. Banner text: "Lane status may be stale. Bus connectivity issue detected."
  2. Display the banner at the top of the lane panel, above the lane list.
  3. Auto-dismiss the banner when bus events resume.
  4. Implement visual distinction: use amber/yellow background to indicate warning without alarm.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_event_handler.ts` (connectivity monitoring)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_panel.ts` (banner display)
- Validation:
  - Unit test: simulate bus silence for 30s, verify stale banner displayed.
  - Unit test: resume events after stale, verify banner dismissed.
- Parallel: No.

### Subtask T011 - Add Playwright end-to-end tests and performance benchmarks
- Purpose: validate the complete lane panel experience and performance SLOs.
- Steps:
  1. Create `apps/desktop/tests/e2e/panels/lane_panel.test.ts`:
     a. Test: open app, verify lane panel visible with correct lanes.
     b. Test: create lane from panel, verify it appears in the list.
     c. Test: attach to a lane, verify context switch and tab updates.
     d. Test: cleanup lane, verify confirmation dialog, confirm, verify removed.
     e. Test: keyboard navigation through lane list.
  2. Create `apps/desktop/tests/e2e/panels/lane_realtime.test.ts`:
     a. Test: emit state change event, verify badge updates within 1 second.
     b. Test: rapid state transitions, verify final state displayed.
     c. Test: lane added externally, verify appears in panel.
     d. Test: lane removed externally, verify removed from panel.
  3. Create `apps/desktop/tests/e2e/panels/lane_performance.test.ts`:
     a. Render 50 lanes, measure initial paint time, assert < 300ms.
     b. Emit 20 state change events, measure update latency, assert p95 < 1s.
  4. Capture screenshots for visual regression baseline.
  5. Aim for >=85% line coverage across panel modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/panels/lane_panel.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/panels/lane_realtime.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/e2e/panels/lane_performance.test.ts`
- Parallel: Yes (after T006-T010 are integrated).

## Test Strategy

- Playwright for UI interactions and real-time update verification.
- Performance benchmarks for render and update latency SLOs.
- Unit test coverage for action handlers and event processing.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: bus event floods cause excessive re-renders.
- Mitigation: requestAnimationFrame batching and debouncing.
- Risk: optimistic UI creates confusion on failure.
- Mitigation: clear revert with error message on action failure.

## Review Guidance

- Confirm cleanup action cannot execute without confirmation dialog.
- Confirm real-time updates use debouncing and event ordering.
- Confirm orphan flag integration refreshes on detection cycle events.
- Confirm stale-status indicator appears on bus timeout and clears on resume.
- Confirm Playwright tests verify all CRUD actions and real-time updates.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:32:45Z – claude-haiku – shell_pid=68186 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:08Z – claude-haiku – shell_pid=68186 – lane=done – Implemented
