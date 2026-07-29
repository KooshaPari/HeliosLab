---
work_package_id: WP02
title: Five Tab Implementations
lane: "done"
dependencies:
- WP01
base_branch: 016-workspace-lane-session-ui-tabs-WP01
base_commit: c7a4349f4a36174dfba88caf89980d043749a5c2
created_at: '2026-03-01T13:32:40.394666+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
- T011
phase: Phase 2 - Tab Surfaces
assignee: ''
agent: "claude-haiku"
shell_pid: "67756"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Five Tab Implementations

## Objectives & Success Criteria

- Implement all five tab surfaces: terminal, agent, session, chat, and project.
- Each tab binds to the active context and renders content appropriate to its purpose.
- All tabs handle data source unavailability with error states rather than crashes.

Success criteria:
- Each tab renders correctly when the active context changes.
- Terminal tab displays the active terminal for the current lane/session.
- All tabs show an error state when their data source is unavailable.
- Tab switch latency stays under 200ms at p95.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/016-workspace-lane-session-ui-tabs/spec.md`
- Tab surface base: `apps/desktop/src/tabs/tab_surface.ts` (WP01)
- Context store: `apps/desktop/src/tabs/context_switch.ts` (WP01)
- Terminal registry: spec 014 (`apps/runtime/src/registry/`)
- Lane/session lifecycle: specs 008, 009

Constraints:
- No blocking data fetches during render.
- All tabs must handle missing/unavailable data gracefully.
- Keep files under 500 lines each.
- TypeScript + Bun + ElectroBun.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement terminal tab surface
- Purpose: display the active terminal for the current lane/session context.
- Steps:
  1. Implement `TerminalTab` extending `TabSurface` in `apps/desktop/src/tabs/terminal_tab.ts`:
     a. `onContextChange(context)`:
        i. Query the terminal registry for terminals bound to the current lane/session.
        ii. If terminals found, display the primary terminal's renderer output.
        iii. If no terminals, display "No terminal for this lane" with option to create one.
     b. `render()`: render the terminal viewport (delegate to renderer adapter output).
     c. `getState()`: return scroll position, terminal_id.
     d. `restoreState(state)`: restore scroll position and terminal selection.
  2. Integrate with terminal spawn: provide a "Create Terminal" action when no terminal exists.
  3. Handle renderer switch: during active switch transaction (spec 013), show a brief loading indicator.
  4. Implement terminal output streaming: connect to the PTY output stream for live rendering.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/terminal_tab.ts`
- Validation:
  - Unit test: set context with active terminal, verify terminal content rendered.
  - Unit test: set context with no terminal, verify empty state message.
  - Unit test: simulate renderer switch, verify loading indicator shown.
- Parallel: Yes (independent of other tabs).

### Subtask T007 - Implement agent tab surface
- Purpose: display agent activity and output for the current lane/session.
- Steps:
  1. Implement `AgentTab` extending `TabSurface` in `apps/desktop/src/tabs/agent_tab.ts`:
     a. `onContextChange(context)`:
        i. Query agent state for the current session/lane.
        ii. Display agent status (idle, running, error), recent actions, and output log.
        iii. If no agent activity, display "No agent activity for this lane."
     b. `render()`: render agent status panel with scrollable output log.
     c. `getState()`: return scroll position in output log.
     d. `restoreState(state)`: restore scroll position.
  2. Implement live update: subscribe to agent events on the bus for the current session.
  3. Handle agent errors: display error details in the tab rather than propagating.
  4. Provide action buttons: restart agent, view full log, copy output.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/agent_tab.ts`
- Validation:
  - Unit test: set context with active agent, verify status and output rendered.
  - Unit test: agent error, verify error details shown in tab.
  - Unit test: no agent activity, verify empty state message.
- Parallel: Yes (independent of other tabs).

### Subtask T008 - Implement session tab surface
- Purpose: display session metadata, lifecycle state, and diagnostics for the current session.
- Steps:
  1. Implement `SessionTab` extending `TabSurface` in `apps/desktop/src/tabs/session_tab.ts`:
     a. `onContextChange(context)`:
        i. Query session metadata from the session registry.
        ii. Display: session ID, creation time, lifecycle state, harness transport mode, terminal count.
        iii. Display session diagnostics: transport choice, degradation reasons if applicable.
     b. `render()`: render session info cards with diagnostics.
     c. `getState()`: return expanded/collapsed section states.
     d. `restoreState(state)`: restore section states.
  2. Show harness transport diagnostic: whether `cliproxy_harness` or `native_openai` is active and why.
  3. Display session timeline: key lifecycle events in chronological order.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/session_tab.ts`
- Validation:
  - Unit test: set context with active session, verify metadata rendered.
  - Unit test: session with degraded transport, verify diagnostic info shown.
  - Unit test: no session, verify error state.
- Parallel: Yes (independent of other tabs).

### Subtask T009 - Implement chat tab surface
- Purpose: display a chat interface for conversational interaction with the agent in the current lane.
- Steps:
  1. Implement `ChatTab` extending `TabSurface` in `apps/desktop/src/tabs/chat_tab.ts`:
     a. `onContextChange(context)`:
        i. Load chat history for the current lane/session.
        ii. Display message list with user and agent messages.
        iii. If no chat history, display empty state with input prompt.
     b. `render()`: render chat message list + input field.
     c. `getState()`: return scroll position and draft input text.
     d. `restoreState(state)`: restore scroll position and draft text.
  2. Implement message input: text input with send action (Enter to send, Shift+Enter for newline).
  3. Implement live message streaming: new agent messages appear in real time.
  4. Handle long messages with collapsible sections.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/chat_tab.ts`
- Validation:
  - Unit test: set context with chat history, verify messages rendered.
  - Unit test: send message, verify it appears in the list.
  - Unit test: no chat history, verify empty state.
- Parallel: Yes (independent of other tabs).

### Subtask T010 - Implement project tab surface
- Purpose: display project metadata and workspace information for the active context.
- Steps:
  1. Implement `ProjectTab` extending `TabSurface` in `apps/desktop/src/tabs/project_tab.ts`:
     a. `onContextChange(context)`:
        i. Query workspace/project metadata (spec 003).
        ii. Display: project name, workspace path, active lanes count, recent activity.
        iii. Display git status summary if applicable.
     b. `render()`: render project info with lane overview list.
     c. `getState()`: return expanded/collapsed section states.
     d. `restoreState(state)`: restore section states.
  2. Display lane summary: list of all lanes in the workspace with their states.
  3. Provide quick actions: create new lane, open workspace in file manager.
  4. Handle workspace unavailability (e.g., disconnected external drive) with error state.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/tabs/project_tab.ts`
- Validation:
  - Unit test: set context with active workspace, verify project info rendered.
  - Unit test: workspace unavailable, verify error state.
  - Unit test: verify lane summary shows correct lane states.
- Parallel: Yes (independent of other tabs).

### Subtask T011 - Add unit tests for all tab surfaces
- Purpose: lock tab behavior and verify context binding correctness.
- Steps:
  1. Create `apps/desktop/tests/unit/tabs/terminal_tab.test.ts`: test context binding, empty state, renderer switch handling.
  2. Create `apps/desktop/tests/unit/tabs/agent_tab.test.ts`: test context binding, error display, empty state.
  3. Create `apps/desktop/tests/unit/tabs/session_tab.test.ts`: test context binding, diagnostics rendering.
  4. Create `apps/desktop/tests/unit/tabs/chat_tab.test.ts`: test context binding, message rendering, input handling.
  5. Create `apps/desktop/tests/unit/tabs/project_tab.test.ts`: test context binding, workspace info, error state.
  6. Each test file should verify:
     a. Tab updates correctly on context change.
     b. Tab displays error state when data source is unavailable.
     c. Tab state serialization/restoration works correctly.
  7. Aim for >=85% line coverage across all tab modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/terminal_tab.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/agent_tab.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/session_tab.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/chat_tab.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tests/unit/tabs/project_tab.test.ts`
- Parallel: Yes (after T006-T010 are implemented).

## Test Strategy

- Unit tests with Vitest using mock context stores and data sources.
- Each tab tested for context binding, error handling, and state persistence.
- Aim for >=85% line coverage.

## Risks & Mitigations

- Risk: tab content loading blocks UI.
- Mitigation: async data fetching with loading indicators.
- Risk: data source failure crashes tab.
- Mitigation: error boundary in base tab surface catches all render errors.

## Review Guidance

- Confirm each tab correctly subscribes to context changes.
- Confirm error states are user-friendly and actionable.
- Confirm state serialization captures all meaningful per-tab state.
- Confirm no tab blocks the main UI thread during data loading.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:32:40Z – claude-haiku – shell_pid=67756 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:35:26Z – claude-haiku – shell_pid=67756 – lane=done – Implemented WP02
