# UI and UX Plan

Date: 2026-02-26

## Objective

Design a rich, high-density UX on top of a terminal-first architecture without compromising responsiveness.

## Research Input: Co(lab)

Reference reviewed: `blackboardsh/colab`.

Observed product signals:
- hybrid browser + code/editor workspace
- multi-tab and multi-pane work model
- plugin architecture emphasis
- startup-builder workflow orientation
- ElectroBun-based shell

Implication for Helios:
- rich UX is feasible on ElectroBun
- density and workflow composability can coexist with low-overhead goals if rendering and event paths stay bounded

## UX Positioning for Helios

Helios should be a:
- terminal-native control center with rich orchestration UX
- not a traditional IDE clone

Primary UX promise:
- high-speed terminal execution plus first-class visibility/control for worktrees, agent lanes, approvals, and handoffs

## Information Architecture

### Global shell
- Top bar:
  - workspace/project switcher
  - global command palette
  - provider profile indicator
  - renderer indicator (`ghostty`/`rio`)
  - system health and policy state

- Left rail:
  - Workspaces
  - Worktree lanes (`par`)
  - Sessions (`zellij` namespaces)
  - Shared sessions (`upterm`/`tmate`)
  - Audit timeline

- Main stage:
  - tabbed/split terminal canvas
  - lane-aware terminal grouping

- Right rail (context panel):
  - lane metadata
  - approvals queue
  - diff/review panel
  - run logs and metrics

### Modal overlays
- Renderer switch modal (hot swap or restart flow)
- Share session modal (`upterm`/`tmate` controls + TTL)
- Policy decision modal for sensitive actions

## Core User Flows

### Flow 1: New task lane
1. User clicks `+ Task Lane`.
2. Select repo, branch strategy, provider profile.
3. Helios creates worktree via `par`.
4. Creates/attaches zellij session and terminals.
5. Lane appears in left rail with live status.

### Flow 2: Renderer switch
1. User toggles renderer in settings.
2. Helios runs capability check.
3. If hot swap supported, switch in-place with brief output pause.
4. If not supported, show fast restart confirmation and preserve session state via zmx.

### Flow 3: Human handoff
1. Operator selects terminal and clicks `Share`.
2. Chooses `upterm` or `tmate`.
3. Approval gate checks policy.
4. Share link/command generated with TTL and permissions.
5. Audit event recorded and visible in timeline.

### Flow 4: Approval and apply
1. Agent proposes command/edit.
2. UI shows rationale + impact + diff.
3. User approves/denies.
4. Result streams back into lane timeline and audit log.

## UI Components

### Must-have components
- Lane list with health states: `idle`, `running`, `blocked`, `error`, `shared`
- Terminal card with provider/session badges
- Approval queue panel with policy reason text
- Diff drawer with staged apply/rollback controls
- Share session drawer with revoke button and expiry timer
- Event timeline with filter chips (`terminal`, `agent`, `policy`, `share`, `audit`)

### Richness without bloat
- Prefer progressive disclosure:
  - lightweight default view
  - deep details in drawers/panels
- Keep heavy charts optional and lazily mounted

## Interaction Model

- Keyboard-first operations:
  - lane navigation
  - split/tab actions
  - share/revoke
  - approve/deny
- Mouse interactions are secondary but fully supported.

- Real-time updates:
  - driven from internal local bus events
  - AG-UI mapping used for frontend stream abstraction

## Visual System

- Terminal-first visual hierarchy:
  - dark neutral base, strong semantic status colors
  - high contrast for state-critical chips and warnings

- Typography:
  - monospace for terminal and command/diff surfaces
  - sans for navigation and metadata

- Motion:
  - small, purposeful transitions for lane state and modal operations
  - no continuous decorative animation

## Performance UX Rules

- Do not re-render inactive terminal panes.
- Throttle high-frequency output paint updates.
- Keep event timeline virtualized.
- Show explicit backpressure indicator when output bursts are clipped.

## Safety UX Rules

- Destructive or share actions always require explicit confirmation.
- Show policy reason and violated rule for denied actions.
- Make revoke/rollback controls always one interaction away.

## Configuration UX

Settings sections:
- Renderer (`ghostty`/`rio` + hot swap preference)
- Session (`zellij`, zmx checkpoint cadence)
- Collaboration (`upterm`/`tmate` defaults, TTL, allowlist)
- Protocol (`ACP`, MCP, A2A adapter toggles)
- Policy (command/path rules)

## MVP Surface

Must ship in MVP:
- Worktree lane manager
- terminal mux canvas
- approvals queue
- share session controls
- renderer switch control
- audit timeline

Can defer post-MVP:
- highly customizable themes/layout presets
- advanced plugin marketplace UI
- multi-user presence indicators beyond share sessions

## Validation Plan

- usability tests with 3 persona groups:
  - terminal-heavy backend engineers
  - platform/on-call operators
  - team leads focused on governance
- benchmark task set:
  - create lane, run task, share handoff, switch renderer, approve patch, rollback
- success condition:
  - all benchmark tasks completed without leaving Helios UI

## Source

- `blackboardsh/colab` repository and README product architecture notes:
  - https://github.com/blackboardsh/colab
