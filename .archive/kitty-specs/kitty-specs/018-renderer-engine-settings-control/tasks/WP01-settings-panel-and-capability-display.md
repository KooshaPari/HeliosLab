---
work_package_id: WP01
title: Settings Panel, Capability Display, and Switch Trigger
lane: "done"
dependencies: []
base_branch: main
base_commit: 4e5826451eb1856b4d5f201af0d08d0286bcbf81
created_at: '2026-03-01T13:34:22.014495+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - Settings Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "74567"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Settings Panel, Capability Display, and Switch Trigger

## Objectives & Success Criteria

- Implement the renderer settings section within the application settings panel.
- Display both ghostty and rio with availability status and capability details.
- Implement the switch confirmation dialog that triggers a renderer switch transaction (spec 013).
- Implement renderer preference persistence.

Success criteria:
- Settings panel lists ghostty and rio with correct availability from feature flags.
- Capability expansion shows version, hot-swap support, and feature list.
- Confirmation dialog clearly indicates whether hot-swap or restart-with-restore will be used.
- Preferences persist across restarts and default to ghostty with hot-swap enabled.
- Settings section renders in under 200ms.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/018-renderer-engine-settings-control/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/018-renderer-engine-settings-control/spec.md`
- Renderer capabilities: spec 010, `apps/runtime/src/renderer/capability_matrix.ts` (spec 013 WP01)
- Feature flags: spec 004
- Switch transaction: spec 013

Constraints:
- ghostty is the default renderer.
- rio may be feature-flagged and unavailable in some builds.
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement renderer settings section container
- Purpose: provide the container component for all renderer settings within the app settings panel.
- Steps:
  1. Implement `RendererSettings` in `apps/desktop/src/settings/renderer_settings.ts`:
     a. Render a settings section with header "Renderer Engine".
     b. Display a brief description: "Choose your terminal renderer engine."
     c. Render child components: renderer options (T002), capability display (T003).
     d. Show the currently active renderer with a prominent indicator.
  2. Integrate into the broader app settings panel (slot or section registration).
  3. Implement section loading state while capabilities are being fetched.
  4. Handle section error state if renderer data is unavailable.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/renderer_settings.ts`
- Validation:
  - Unit test: render section, verify header and description displayed.
  - Unit test: verify active renderer indicator shows current selection.
  - Unit test: verify loading state during capability fetch.
  - Benchmark: render section, assert < 200ms.
- Parallel: No.

### Subtask T002 - Implement renderer option component
- Purpose: display a selectable renderer entry with availability and active status.
- Steps:
  1. Implement `RendererOption` in `apps/desktop/src/settings/renderer_option.ts`:
     a. Accept: renderer ID, name, availability status, isActive flag.
     b. Display: renderer name, availability badge (available/unavailable), active indicator.
     c. Available renderer: clickable, selectable.
     d. Unavailable renderer: grayed out, not selectable, tooltip explaining why unavailable.
     e. Active renderer: highlighted with "Active" badge.
  2. On selection:
     a. If selecting a different renderer than active, trigger confirmation dialog (T004).
     b. If selecting the already-active renderer, do nothing.
  3. Query feature flags (spec 004) for availability:
     a. ghostty: always available.
     b. rio: available only when the `rio_renderer` feature flag is enabled.
  4. FR-018-002: display both renderers with availability status.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/renderer_option.ts`
- Validation:
  - Unit test: render available renderer, verify clickable.
  - Unit test: render unavailable renderer, verify grayed out and not clickable.
  - Unit test: render active renderer, verify "Active" badge.
  - Unit test: select different renderer, verify confirmation triggered.
- Parallel: No.

### Subtask T003 - Implement capability display expansion panel
- Purpose: show detailed renderer capabilities when a user expands a renderer entry.
- Steps:
  1. Implement `CapabilityDisplay` in `apps/desktop/src/settings/capability_display.ts`:
     a. Accept: renderer capabilities from the capability matrix (spec 013 WP01 T002).
     b. Display in an expandable panel:
        i. Version string.
        ii. Hot-swap support: "Supported" (green) or "Not supported - switch requires restart" (amber).
        iii. Feature list (e.g., GPU acceleration, ligatures, sixel support).
        iv. Platform constraints if any.
     c. Collapsed by default; expand on click or keyboard Enter.
  2. Implement loading state if capabilities are being fetched.
  3. Implement error state if capabilities unavailable: "Capability information unavailable."
  4. FR-018-002: display capabilities including hot-swap support.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/capability_display.ts`
- Validation:
  - Unit test: render capabilities for ghostty (hot-swap supported), verify green indicator.
  - Unit test: render capabilities for rio (hot-swap not supported), verify amber warning.
  - Unit test: expand/collapse toggle.
  - Unit test: loading state when capabilities unavailable.
- Parallel: No.

### Subtask T004 - Implement switch confirmation dialog and trigger
- Purpose: require user confirmation before triggering a renderer switch transaction.
- Steps:
  1. Implement `SwitchConfirmation` in `apps/desktop/src/settings/switch_confirmation.ts`:
     a. Display modal dialog when user selects a different renderer:
        i. Title: "Switch Renderer Engine?"
        ii. Body: describe which renderer is being switched to and the switch method.
        iii. If hot-swap available: "This will use hot-swap for a seamless transition (~3 seconds)."
        iv. If hot-swap unavailable: "This will restart the renderer with session restore (~8 seconds)."
        v. Warning: "All active terminals will be briefly interrupted."
     b. Confirm button: trigger the switch transaction via spec 013 `startSwitch(targetRendererId)`.
     c. Cancel button: dismiss the dialog, no action.
  2. Implement keyboard accessibility:
     a. Escape to cancel.
     b. Enter to confirm.
     c. Focus trapped within dialog.
  3. After trigger:
     a. Dismiss the dialog.
     b. Show the status indicator (WP02 T008) for progress feedback.
  4. FR-018-003: require confirmation before triggering switch.
  5. FR-018-004: trigger the switch transaction on confirmation.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/switch_confirmation.ts`
- Validation:
  - Unit test: confirm, verify `startSwitch` called with correct renderer ID.
  - Unit test: cancel, verify no switch triggered.
  - Unit test: verify dialog shows hot-swap vs restart-with-restore message based on capability.
  - Unit test: Escape dismisses dialog.
- Parallel: No.

### Subtask T005 - Implement renderer preference persistence
- Purpose: persist the user's renderer selection and settings across runtime restarts.
- Steps:
  1. Implement `RendererPreferences` in `apps/desktop/src/settings/renderer_preferences.ts`:
     a. Store: `{ activeRenderer: string, hotSwapEnabled: boolean }`.
     b. Default: `{ activeRenderer: 'ghostty', hotSwapEnabled: true }`.
     c. `save(prefs)`: write to `~/.helios/data/renderer_preferences.json`.
     d. `load(): RendererPreferences`: read from disk; return defaults if missing or corrupt.
  2. Implement auto-save:
     a. After a successful switch transaction, save the new active renderer.
     b. After hot-swap toggle change (WP02), save the preference.
  3. Implement load-on-startup:
     a. Load preferences within 100ms of startup (NFR-018-003).
     b. If the preferred renderer is unavailable, fall back to ghostty and warn.
  4. FR-018-007: persist preferences across sessions.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/settings/renderer_preferences.ts`
- Validation:
  - Unit test: save preferences, reload, verify values match.
  - Unit test: corrupt file, verify defaults loaded.
  - Unit test: preferred renderer unavailable, verify fallback to ghostty with warning.
  - Benchmark: load completes in < 100ms.
- Parallel: No.

### Subtask T006 - Add unit tests for settings panel, capability display, and preferences
- Purpose: lock settings UI behavior.
- Steps:
  1. Create `apps/desktop/tests/unit/settings/renderer_settings.test.ts`:
     a. Test section rendering with both renderers.
     b. Test active renderer indicator.
     c. Test loading and error states.
  2. Create `apps/desktop/tests/unit/settings/renderer_option.test.ts`:
     a. Test available, unavailable, and active states.
     b. Test selection triggers confirmation.
  3. Create `apps/desktop/tests/unit/settings/capability_display.test.ts`:
     a. Test expand/collapse.
     b. Test hot-swap and non-hot-swap capability display.
  4. Create `apps/desktop/tests/unit/settings/switch_confirmation.test.ts`:
     a. Test confirm/cancel flows.
     b. Test keyboard accessibility.
     c. Test hot-swap vs restart-with-restore messaging.
  5. Create `apps/desktop/tests/unit/settings/renderer_preferences.test.ts`:
     a. Test save/load cycle.
     b. Test corrupt file recovery.
     c. Test unavailable renderer fallback.
  6. Aim for >=85% line coverage.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/settings/renderer_settings.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/settings/renderer_option.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/settings/capability_display.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/settings/switch_confirmation.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/settings/renderer_preferences.test.ts`
- Parallel: Yes (after T001-T005 interfaces are stable).

## Test Strategy

- Unit tests with Vitest for all settings UI components.
- Mock capability matrix and feature flag APIs.
- Persistence tests with real file I/O.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: capability data unavailable at render time.
- Mitigation: loading state with graceful fallback.
- Risk: preference file corruption.
- Mitigation: defaults on corrupt file with warning.

## Review Guidance

- Confirm both renderers displayed with correct availability from feature flags.
- Confirm confirmation dialog message varies based on hot-swap capability.
- Confirm preferences default to ghostty with hot-swap enabled.
- Confirm persistence load timing meets 100ms target.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:34:22Z – claude-haiku – shell_pid=74567 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:36:23Z – claude-haiku – shell_pid=74567 – lane=done – Implemented
