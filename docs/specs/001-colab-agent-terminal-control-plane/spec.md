# Feature Specification: Terminal-First Desktop Shell

**Feature Branch**: `001-colab-agent-terminal-control-plane`
**Created**: 2026-02-26
**Updated**: 2026-02-27
**Status**: Draft

## Overview

Master specification for the heliosApp desktop shell. Scope: fork co(lab), strip the embedded editor and browser chrome, establish ElectroBun as the desktop shell with a terminal-first layout, command palette scaffolding, window management, and app lifecycle. This spec owns the shell — not the bus (002), not the renderer (010-013), not the mux or sessions (008-009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Launch and Reach Interactive Shell (Priority: P0)

As an operator, I can launch heliosApp and reach an interactive terminal pane within 2 seconds so I can begin work immediately.

**Why this priority**: First-launch experience defines whether the product feels "insanely snappy."

**Independent Test**: Cold-start the app on reference hardware, measure wall-clock time from process spawn to first keystroke accepted in the terminal pane.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user launches heliosApp, **Then** an interactive terminal pane is focused and accepting input within 2 seconds.
2. **Given** a previous session existed, **When** the user relaunches, **Then** the shell frame restores window geometry and workspace binding before terminal panes re-attach.
3. **Given** a critical subsystem fails during boot (e.g., renderer unavailable), **Then** the shell displays a degraded-mode banner and remains operable for diagnostics.

---

### User Story 2 — Terminal-First Layout and Navigation (Priority: P0)

As an operator, I can navigate between terminal panes, tabs, and management views without touching an embedded editor because the shell is built around terminals, not around a code editor.

**Why this priority**: The product thesis is an editorless IDE — the layout must prove this works.

**Independent Test**: Complete a multi-pane workflow (split, navigate, close, reorder) using only keyboard shortcuts and command palette.

**Acceptance Scenarios**:

1. **Given** an active workspace, **When** the user opens terminal, agent, session, chat, and project tabs, **Then** each tab renders correctly and reflects current workspace context.
2. **Given** multiple panes, **When** the user uses keyboard shortcuts to split/navigate/close, **Then** focus moves predictably and layout state is preserved.
3. **Given** a command palette invocation, **When** the user types a partial command, **Then** matching actions are surfaced with sub-100ms filter latency.

---

### User Story 3 — Window Lifecycle and Multi-Window (Priority: P1)

As an operator, I can open multiple windows, each bound to a workspace, and close/reopen them without losing state.

**Why this priority**: Multi-window is table-stakes for desktop IDE usage.

**Acceptance Scenarios**:

1. **Given** an open window, **When** the user closes it, **Then** window geometry and workspace binding are persisted.
2. **Given** two windows bound to different workspaces, **When** one crashes, **Then** the other remains fully operational.
3. **Given** the last window is closed, **When** the user relaunches, **Then** the previous window set is offered for restore.

---

### Edge Cases

- Shell must handle renderer process crash without losing window chrome or workspace binding.
- Command palette must remain functional even when terminal panes are unresponsive.
- Layout must degrade gracefully when screen resolution is below minimum supported (1280x720).
- Window close during an active checkpoint operation must block until checkpoint completes or times out.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST fork co(lab) and strip embedded editor, browser, and non-terminal UI surfaces to produce a terminal-first shell.
- **FR-002**: The system MUST bootstrap an ElectroBun desktop shell that reaches interactive state within 2 seconds on reference hardware.
- **FR-003**: The system MUST provide a terminal-first default layout with split panes, tab bar, and sidebar for workspace/project navigation.
- **FR-004**: The system MUST provide a command palette accessible via global keyboard shortcut that supports fuzzy search over registered actions.
- **FR-005**: The system MUST manage window lifecycle: create, close, minimize, maximize, restore geometry, and persist window state across restarts.
- **FR-006**: The system MUST support multiple windows, each independently bound to a workspace context.
- **FR-007**: The system MUST provide tab management for terminal, agent, session, chat, and project views within each window.
- **FR-008**: The system MUST expose a shell-level extension point for subsystems (renderer, mux, bus) to register capabilities and UI surfaces.
- **FR-009**: The system MUST implement graceful shutdown that signals all subsystems and waits for in-flight operations before exit.
- **FR-010**: The system MUST display a degraded-mode banner when a critical subsystem is unavailable, keeping the shell operable for diagnostics.

#### FR-010 Boundary Contract Mapping

| Boundary | Canonical Commands | Canonical Events | Runtime Adapter |
|----------|--------------------|------------------|-----------------|
| local control | `boundary.local.dispatch`, `lane.create`, `session.attach`, `terminal.spawn` | `boundary.local.dispatched`, lifecycle topics | `local_bus` |
| tool interoperability | `boundary.tool.dispatch`, `approval.request.resolve`, `share.upterm.start`, `zmx.checkpoint` | `boundary.tool.dispatched`, `boundary.dispatch.failed` | `tool_bridge` |
| agent-to-agent delegation | `boundary.a2a.dispatch`, `agent.run`, `agent.cancel` | `boundary.a2a.delegated`, `boundary.dispatch.failed` | `a2a_bridge` |

### Non-Functional Requirements

- **NFR-001**: Startup to interactive terminal MUST be < 2 seconds (p95) on reference hardware (8 GB RAM, 4-core CPU).
- **NFR-002**: Command palette filter latency MUST be < 100ms (p95) for up to 500 registered actions.
- **NFR-003**: Steady-state memory for the shell frame (excluding renderer and terminal buffers) MUST be < 80 MB. This is the shell component budget within the 500 MB system-wide steady-state target defined in the constitution. Other components (renderer, terminal buffers, runtime daemon) have separate budgets.
- **NFR-004**: Window close-to-reopen restore MUST preserve geometry within 1px tolerance.
- **NFR-005**: Shell frame rendering MUST maintain 60 FPS on active UI surfaces.

### Dependencies

- **Spec 002** (Local Bus): Shell dispatches commands and subscribes to events via the bus protocol.
- **Spec 007** (Zellij Mux Integration): Terminal pane layout delegates to zellij for multiplexing.
- **Spec 010** (Ghostty Renderer): Terminal rendering is handled by renderer subsystem, not the shell.

## Key Entities

- **Shell Frame**: Top-level ElectroBun window host managing chrome, layout containers, and subsystem lifecycle.
- **Window**: OS-level window instance bound to exactly one workspace, owning layout state and tab set.
- **Layout**: Arrangement of panes and tabs within a window, serializable for persistence and restore.
- **Command Palette**: Fuzzy-search action dispatcher registered by shell and subsystems.
- **Tab**: Named view container (terminal, agent, session, chat, project) within a window.

## Success Criteria *(mandatory)*

- **SC-001**: Cold start reaches interactive terminal in < 2s on reference hardware in 95% of test runs.
- **SC-002**: Users complete a full editorless workflow (open workspace, split panes, navigate tabs, close/reopen window) with 90%+ first-attempt success rate in usability testing.
- **SC-003**: Shell survives renderer process crash without losing window state in 100% of chaos test injections.
- **SC-004**: Command palette returns filtered results in < 100ms for 500 registered actions in 95% of measurements.
- **SC-005**: Multi-window isolation verified: crash in window A produces zero observable effect on window B.

## Assumptions

- co(lab) fork is the starting point; strip-and-rebuild is preferred over rewrite per constitution ("fork before build").
- Renderer, mux, and protocol bus are separate subsystems with their own specs; this spec owns only the shell host.
- Reference hardware: 8 GB RAM, 4-core CPU, macOS or Linux.
- Post-MVP: plugin system, collaboration overlays, personal feature packs.
