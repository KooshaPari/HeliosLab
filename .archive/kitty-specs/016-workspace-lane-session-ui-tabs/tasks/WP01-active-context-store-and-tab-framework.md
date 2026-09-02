---
work_package_id: WP01
title: Active Context Store and Tab Surface Framework
lane: "done"
dependencies: []
base_branch: main
base_commit: d96fb53a83841cde41a446e6c69ba26e888cd207
created_at: '2026-03-01T13:29:17.148173+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "53948"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Active Context Store and Tab Surface Framework

## Objectives & Success Criteria

- Implement the shared active context store as the single source of truth for the current workspace/lane/session triple.
- Implement the base tab surface component that binds to the active context.
- Implement the tab bar with selection, ordering, reordering, and pinning.
- Implement tab state persistence across runtime restarts.

Success criteria:
- Context store emits change events when the active triple changes.
- Tab bar renders all five tab types with correct selection highlighting.
- Tab selection and ordering persist across restarts and load within 100ms.
- Tab surfaces bind to the active context and react to changes.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/spec.md`
- Internal event bus: `apps/runtime/src/protocol/bus.ts` (spec 001)
- Terminal registry: spec 014
- Lane/session lifecycle: specs 008, 009

Constraints:
- Tab UI must not block the main thread.
- All actions must be keyboard-accessible.
- Keep files under 500 lines.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement shared active context store
- Purpose: provide a single source of truth for the current workspace/lane/session driving all tab content.
- Steps:
  1. Implement `ActiveContextStore` in `apps/desktop/src/tabs/context_switch.ts`:
     a. Hold current context: `{ workspaceId: string, laneId: string, sessionId: string } | null`.
     b. Expose `setContext(context)`: update the active context and emit a change event.
     c. Expose `getContext()`: return the current context.
     d. Expose `onContextChange(callback)`: register a listener for context changes.
     e. Expose `clearContext()`: set context to null (no active context).
  2. Implement change event:
     a. Emit event with both previous and new context for comparison.
     b. Publish on the internal bus as `context.active.changed`.
  3. Implement debouncing for rapid changes:
     a. If multiple `setContext` calls arrive within 50ms, only emit the final one.
     b. This prevents intermediate render flicker during rapid lane switches.
  4. Implement context validation:
     a. Before accepting a new context, validate that the workspace, lane, and session exist.
     b. If validation fails, reject the change and emit a `context.validation.failed` event.
  5. Export the store as a singleton for app-wide use.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/context_switch.ts`
- Validation:
  - Unit test: set context, assert change event emitted with correct previous/new values.
  - Unit test: rapid context changes, assert only final context is emitted.
  - Unit test: invalid context, assert rejection with validation error.
  - Unit test: clear context, assert null context and change event.
- Parallel: No.

### Subtask T002 - Implement base tab surface component
- Purpose: define the abstract base for all tab surfaces with context binding and lifecycle management.
- Steps:
  1. Implement `TabSurface` base class/interface in `apps/desktop/src/tabs/tab_surface.ts`:
     a. Properties: `tabId`, `tabType` (terminal|agent|session|chat|project), `label`, `isActive`.
     b. `onContextChange(context)`: called when the active context changes; subclasses implement to update content.
     c. `onActivate()`: called when this tab becomes the selected tab.
     d. `onDeactivate()`: called when another tab becomes selected.
     e. `render()`: render the tab content (subclass responsibility).
     f. `getState()`: return serializable tab state for persistence.
     g. `restoreState(state)`: restore from persisted state.
  2. Implement context binding:
     a. On construction, subscribe to the active context store's change events.
     b. Call `onContextChange` with the new context.
     c. If context change fails for this tab, set a `staleContext` flag.
  3. Implement error boundary:
     a. If `render()` throws, display an error state within the tab rather than crashing.
     b. Log the error and emit a tab error event.
  4. Export the base class for tab implementations (WP02).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/tab_surface.ts`
- Validation:
  - Unit test: create mock tab surface, change context, assert `onContextChange` called.
  - Unit test: simulate render error, assert error state displayed.
  - Unit test: activate/deactivate lifecycle calls.
- Parallel: No.

### Subtask T003 - Implement tab bar component
- Purpose: render the tab bar with selection, ordering, reordering, and pinning controls.
- Steps:
  1. Implement `TabBar` in `apps/desktop/src/tabs/tab_bar.ts`:
     a. Accept a list of `TabSurface` instances.
     b. Render tab headers with labels and active/inactive styling.
     c. Handle tab selection: click or keyboard shortcut activates a tab.
     d. Handle tab reordering: drag-and-drop (mouse) and keyboard-based reorder.
     e. Handle tab pinning: pinned tabs appear first and cannot be reordered past other pinned tabs.
  2. Implement selection management:
     a. Track the currently selected tab.
     b. On selection change, call `onDeactivate` on previous and `onActivate` on new tab.
     c. Emit `tab.selected` event on the bus.
  3. Implement visual indicators:
     a. Active tab gets distinct styling.
     b. Stale-context tab gets a warning indicator (yellow dot or similar).
  4. Implement keyboard accessibility:
     a. Tab/Shift-Tab moves focus between tab headers.
     b. Enter/Space activates the focused tab.
     c. Arrow keys move between adjacent tabs.
  5. FR-016-007: support tab reordering and pinning as user preferences.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/tab_bar.ts`
- Validation:
  - Unit test: render tab bar with 5 tabs, select each, verify selection state.
  - Unit test: reorder tabs, verify new order.
  - Unit test: pin tab, verify it appears first.
  - Unit test: keyboard navigation cycles through tabs.
- Parallel: No.

### Subtask T004 - Implement tab state persistence
- Purpose: persist tab selection, order, and per-tab state across runtime restarts.
- Steps:
  1. Implement `TabPersistence` in `apps/desktop/src/tabs/tab_persistence.ts`:
     a. Serialize: current selected tab, tab order, per-tab state (from `getState()`).
     b. Storage: file-backed JSON at `~/.helios/data/tab_state.json`.
     c. `save()`: write current state to disk; debounce at 500ms to avoid write storms.
     d. `load(): TabPersistedState | null`: read from disk on startup.
     e. `restore(tabs: TabSurface[])`: apply persisted state to tab instances.
  2. Implement load timing:
     a. Load must complete within 100ms of startup (NFR-016-003 related).
     b. If load fails or file is corrupt, use defaults (terminal tab selected, default order).
  3. Wire persistence into tab bar:
     a. On tab selection change -> schedule save.
     b. On tab reorder -> schedule save.
     c. On graceful shutdown -> immediate flush.
  4. FR-016-006: tab selection state persists across runtime restarts.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/tab_persistence.ts`
- Validation:
  - Unit test: save tab state, reload, verify selection and order match.
  - Unit test: corrupt file, verify defaults loaded.
  - Benchmark: verify load completes in <100ms.
- Parallel: No.

### Subtask T005 - Add unit tests for context store, tab bar, and persistence
- Purpose: lock behavior before tab surface implementations.
- Steps:
  1. Create `apps/desktop/tests/unit/tabs/context_switch.test.ts`:
     a. Test context set/get/clear lifecycle.
     b. Test change event emission with previous/new values.
     c. Test debouncing of rapid changes.
     d. Test validation rejection for invalid contexts.
  2. Create `apps/desktop/tests/unit/tabs/tab_bar.test.ts`:
     a. Test tab selection management.
     b. Test reordering and pinning.
     c. Test keyboard navigation.
     d. Test stale-context indicator display.
  3. Create `apps/desktop/tests/unit/tabs/tab_persistence.test.ts`:
     a. Test save/load cycle.
     b. Test corrupt file recovery.
     c. Test debounced saves.
  4. Aim for >=85% line coverage.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/context_switch.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/tab_bar.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/tab_persistence.test.ts`
- Parallel: Yes (after T001-T004 interfaces are stable).

## Test Strategy

- Unit tests with Vitest for store, bar, and persistence logic.
- Mock context changes to verify event propagation.
- Benchmark persistence load timing.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: context store race conditions during rapid switches.
- Mitigation: debouncing with latest-wins semantics.
- Risk: persistence file corruption.
- Mitigation: graceful fallback to defaults with warning.

## Review Guidance

- Confirm context store is a true singleton with no alternative state sources.
- Confirm debouncing prevents intermediate renders.
- Confirm tab bar keyboard accessibility covers all required patterns.
- Confirm persistence load timing meets 100ms target.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:17Z – claude-haiku – shell_pid=53948 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:32:31Z – claude-haiku – shell_pid=53948 – lane=done – Implemented WP01
