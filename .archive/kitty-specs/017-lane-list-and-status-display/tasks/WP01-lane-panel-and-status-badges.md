---
work_package_id: WP01
title: Lane Panel Component, Status Badges, and State Mapping
lane: "done"
dependencies: []
base_branch: main
base_commit: ad271332afa1bf64d5885d7f261341df60620153
created_at: '2026-03-01T13:29:22.019562+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Panel Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "54171"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Lane Panel Component, Status Badges, and State Mapping

## Objectives & Success Criteria

- Implement the left-rail lane panel showing all lanes in the active workspace.
- Implement color-coded status badges mapping to the full lane state machine.
- Implement scrollable lane list with sticky workspace grouping headers.
- Implement keyboard navigation within the lane list.

Success criteria:
- Panel renders all lanes with correct status badges matching their lifecycle state.
- Badge colors follow the spec: idle=gray, running=green, blocked=yellow, error=red, shared=blue, provisioning/cleaning=busy, closed=removed/closed.
- Panel renders 50 lanes in under 300ms.
- Arrow keys navigate between lanes; Enter attaches to selected lane.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/017-lane-list-and-status-display/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/017-lane-list-and-status-display/spec.md`
- Lane lifecycle: spec 008
- Session lifecycle: spec 009
- Orphan detection: spec 015
- ID standards: spec 005

Constraints:
- Must not block main UI thread during updates.
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement lane panel container
- Purpose: render the left-rail panel with a scrollable lane list and workspace grouping.
- Steps:
  1. Implement `LanePanel` in `apps/desktop/src/panels/lane_panel.ts`:
     a. Accept the active workspace context and lane data as props/dependencies.
     b. Render a left-rail panel component that fits within the ElectroBun layout.
     c. Display a header with "Lanes" title and a create-lane action button.
     d. Render the lane list below the header.
  2. Implement scrollable list:
     a. Use a scrollable container for the lane list.
     b. Implement sticky workspace grouping headers if multiple workspaces are visible.
     c. For lists exceeding 50 items, consider virtual scrolling for performance.
  3. Implement empty state: "No lanes in this workspace. Create one to get started."
  4. Implement loading state during initial data fetch.
  5. Implement the panel's mount/unmount lifecycle to manage event subscriptions.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_panel.ts`
- Validation:
  - Unit test: render panel with 5 lanes, verify all displayed.
  - Unit test: render panel with 0 lanes, verify empty state.
  - Unit test: render panel with 50 lanes, verify scroll behavior.
  - Benchmark: render 50 lanes, assert initial paint < 300ms.
- Parallel: No.

### Subtask T002 - Implement status badge component
- Purpose: display a color-coded indicator for each lane's current lifecycle state.
- Steps:
  1. Implement `StatusBadge` in `apps/desktop/src/panels/status_badge.ts`:
     a. Accept a `laneState: string` prop.
     b. Map lane states to visual indicators:
        i. `idle` -> gray dot + "Idle" tooltip.
        ii. `running` -> green dot + "Running" tooltip.
        iii. `blocked` -> yellow dot + "Blocked" tooltip.
        iv. `error` -> red dot + "Error" tooltip.
        v. `shared` -> blue dot + "Shared" tooltip.
        vi. `provisioning` -> animated spinner + "Provisioning..." tooltip.
        vii. `cleaning` -> animated spinner + "Cleaning..." tooltip.
        viii. `closed` -> gray X or "Closed" badge.
        ix. `orphaned` -> orange warning icon + "Orphaned" tooltip (spec 015 integration).
     c. Unknown states: display gray question mark + "Unknown state" tooltip.
  2. Implement color theming:
     a. Badge colors should be configurable via theme settings.
     b. Provide a default color scheme matching the spec.
  3. Implement accessibility:
     a. Badge includes ARIA label describing the state.
     b. Color is not the only indicator (icon shape varies by state).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/status_badge.ts`
- Validation:
  - Unit test: render badge for each state, verify correct color and icon.
  - Unit test: unknown state, verify fallback display.
  - Unit test: verify ARIA labels are present for each state.
- Parallel: No.

### Subtask T003 - Implement lane list item component
- Purpose: render a single lane entry with status badge, label, and action triggers.
- Steps:
  1. Implement `LaneListItem` in `apps/desktop/src/panels/lane_list_item.ts`:
     a. Display: status badge (T002), lane name/ID, optional session count.
     b. Display selected/highlighted state when this is the currently navigated item.
     c. Display the currently attached lane with a distinct active indicator.
     d. On click: trigger attach action (switch to this lane).
     e. On right-click or overflow menu: show actions (attach, detach, cleanup).
  2. Implement hover state with subtle highlight.
  3. Implement the orphan flag: if lane is flagged as orphaned (spec 015), display a distinct warning icon next to the badge.
  4. Implement truncation for long lane names with tooltip showing full name.
  5. Export the component for use in the lane panel.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/lane_list_item.ts`
- Validation:
  - Unit test: render item for running lane, verify badge + label.
  - Unit test: render item for orphaned lane, verify warning icon.
  - Unit test: long lane name, verify truncation + tooltip.
  - Unit test: selected state, verify highlight.
- Parallel: No.

### Subtask T004 - Implement keyboard navigation
- Purpose: enable keyboard-first lane list navigation.
- Steps:
  1. Implement `KeyboardNav` in `apps/desktop/src/panels/keyboard_nav.ts`:
     a. Arrow Up/Down: move selection through the lane list.
     b. Enter: attach to the selected lane (trigger context switch).
     c. Delete/Backspace: initiate cleanup for the selected lane (with confirmation).
     d. Home/End: jump to first/last lane.
  2. Implement focus management:
     a. When the lane panel receives focus, highlight the first (or previously selected) lane.
     b. Visual focus indicator matches the selected item.
     c. Focus should not leave the panel on arrow key at boundaries (wrap or stop).
  3. Wire keyboard events into the lane panel component.
  4. FR-017-007: support keyboard navigation within the lane list.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/keyboard_nav.ts`
- Validation:
  - Unit test: arrow down through 5 lanes, verify selection moves.
  - Unit test: Enter on selected lane, verify attach triggered.
  - Unit test: arrow at boundary, verify no out-of-bounds.
  - Unit test: Home/End navigation.
- Parallel: No.

### Subtask T005 - Add unit tests for panel, badge, list item, and keyboard nav
- Purpose: lock rendering and interaction behavior.
- Steps:
  1. Create `apps/desktop/tests/unit/panels/lane_panel.test.ts`:
     a. Test rendering with various lane counts (0, 5, 50).
     b. Test empty state display.
     c. Test scrolling behavior.
  2. Create `apps/desktop/tests/unit/panels/status_badge.test.ts`:
     a. Test each lane state produces correct color/icon.
     b. Test unknown state fallback.
     c. Test accessibility attributes.
  3. Create `apps/desktop/tests/unit/panels/lane_list_item.test.ts`:
     a. Test rendering for each state including orphan flag.
     b. Test truncation and tooltip.
     c. Test click and menu interactions.
  4. Create `apps/desktop/tests/unit/panels/keyboard_nav.test.ts`:
     a. Test arrow key navigation.
     b. Test Enter to attach.
     c. Test boundary behavior.
  5. Create render benchmark test:
     a. Render 50 lanes, measure time, assert < 300ms.
  6. Aim for >=85% line coverage.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/panels/lane_panel.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/panels/status_badge.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/panels/lane_list_item.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/panels/keyboard_nav.test.ts`
- Parallel: Yes (after T001-T004 interfaces are stable).

## Test Strategy

- Unit tests with Vitest for rendering and interaction logic.
- Render benchmarks for performance SLOs.
- Accessibility tests for ARIA labels and keyboard interaction.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: large lane lists cause performance degradation.
- Mitigation: virtual scrolling for lists > 50 items; benchmark enforced.
- Risk: badge state mapping misses a state from spec 008.
- Mitigation: exhaustive test covering every state from the lane state machine.

## Review Guidance

- Confirm badge mapping covers ALL states from the lane state machine (spec 008).
- Confirm keyboard navigation works without conflicting with tab shortcuts (spec 016).
- Confirm orphan flag integration queries spec 015 correctly.
- Confirm render benchmark passes at 50 lanes.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:22Z – claude-haiku – shell_pid=54171 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:32:34Z – claude-haiku – shell_pid=54171 – lane=done – Implemented
