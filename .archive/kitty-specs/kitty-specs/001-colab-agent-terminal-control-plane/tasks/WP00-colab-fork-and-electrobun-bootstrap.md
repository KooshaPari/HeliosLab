---
work_package_id: WP00
title: "Co(Lab) Fork and ElectroBun Bootstrap"
lane: "done"
dependencies: []
base_branch: main
base_commit: ''
created_at: '2026-02-27T00:00:00.000000+00:00'
subtasks:
- T000a
- T000b
- T000c
- T000d
- T000e
- T000f
- T000g
- T000h
phase: Phase 0 - Foundation
assignee: ''
agent: ''
shell_pid: ''
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated manually as prerequisite WP
---

# Work Package Prompt: WP00 - Co(Lab) Fork and ElectroBun Bootstrap

## Objectives & Success Criteria

- Fork co(lab) from Blackboard/ElectroBun and establish a clean, buildable baseline.
- Strip editor/browser-first panes and bootstrap a terminal-first shell layout.
- Integrate one real renderer (ghostty) rendering actual PTY output inside an ElectroBun window.
- Wire zellij mux, par lane execution, and zmx session durability primitives.
- Verify end-to-end keystroke-to-screen pipeline with measured latency.

Success criteria:
- ElectroBun fork builds cleanly with no editor/browser pane remnants in the main stage.
- Ghostty renderer spawns a real PTY and renders output inside the ElectroBun window.
- Zellij sessions can be created/attached from the control plane.
- Par lanes map to git worktree-backed tasks.
- Zmx checkpoint/restore basics function for session durability.
- End-to-end latency (keystroke to rendered frame) is measured and baselined.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
- Architecture docs: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/`

Constraints:
- This is a prerequisite to all other work packages (P0).
- Keep the fork minimal — remove what is not needed, do not add speculative features.
- Measure before optimizing; capture initial perf metrics at fork baseline.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP00`

## Keep / Rewrite / Delete Matrix

This matrix governs which co(lab) subsystems survive the fork:

### KEEP (carry forward as-is or with minor adaptation)
- Desktop shell bootstrap (ElectroBun app lifecycle, window management)
- Workspace/project primitives (project model, workspace state)
- Command palette scaffolding (keybinding dispatch, palette UI skeleton)

### REWRITE (replace with Helios-specific implementations)
- Main-stage layout → terminal-first (replace editor/browser split with terminal panes)
- Runtime boundary → local bus contract (replace remote-first IPC with local event bus)
- Task orchestration → par lanes (replace task runner with par-based lane execution)
- Session runtime → zellij + zmx (replace session model with zellij mux + zmx checkpoints)
- Renderer subsystem → dual adapter (replace single renderer with ghostty/xterm.js adapter layer)

### DELETE (remove entirely)
- Browser/editor-first panes and associated DOM models
- Heavy DOM/editor models (Monaco, CodeMirror, or equivalent editor state)
- Synchronous indexing pipelines (file indexers, symbol caches)
- Non-essential starter flows (onboarding wizards, template galleries)

## Subtasks & Detailed Guidance

### Subtask T000a - Fork co(lab) repo and establish baseline build
- Purpose: Create the fork, verify ElectroBun builds cleanly, capture initial binary size and startup time metrics.
- Steps:
  1. Fork co(lab) from Blackboard/ElectroBun upstream.
  2. Verify the fork builds with ElectroBun toolchain (Bun + Zig native layer).
  3. Capture baseline metrics: binary size, cold start time, memory at idle.
  4. Tag the baseline commit for future comparison.
- Files:
  - Repository root build configuration
  - `package.json`, `bun.lockb`, ElectroBun config files
- Parallel: No.

### Subtask T000b - Surface reduction: remove editor/browser-first panes
- Purpose: Strip all editor and browser-first UI surfaces per the DELETE matrix; establish terminal-first layout placeholders.
- Steps:
  1. Identify and remove editor pane components (Monaco/CodeMirror integrations, editor state models).
  2. Remove browser-first pane components and associated routing.
  3. Remove synchronous indexing pipelines and non-essential starter flows.
  4. Replace removed main-stage areas with terminal-first layout placeholder containers.
  5. Verify build still succeeds after removals.
- Files:
  - `apps/desktop/src/` (layout and pane components)
  - Editor/browser integration modules
- Parallel: No.

### Subtask T000c - Integrate ghostty renderer: spawn real PTY, pipe through ghostty, render to ElectroBun window
- Purpose: Wire the first real terminal renderer — ghostty rendering actual PTY output inside the ElectroBun window.
- Steps:
  1. Add ghostty as a renderer dependency (library or subprocess integration).
  2. Implement PTY spawn using node-pty or Bun-native PTY bindings.
  3. Pipe PTY stdout/stderr through ghostty's rendering pipeline.
  4. Mount ghostty's rendered output into the ElectroBun window surface.
  5. Verify basic shell interaction (type command, see output).
- Files:
  - `apps/desktop/src/` (renderer integration)
  - `apps/runtime/src/` (PTY spawn layer)
- Parallel: No.

### Subtask T000d - Integrate zellij as mux backend
- Purpose: Enable zellij session creation and attachment from the control plane.
- Steps:
  1. Add zellij as a managed subprocess dependency.
  2. Implement session create/attach/detach commands targeting zellij.
  3. Route terminal pane content through zellij-managed sessions.
  4. Verify multi-pane layout via zellij from the control plane.
- Files:
  - `apps/runtime/src/sessions/` (zellij integration module)
- Parallel: No.

### Subtask T000e - Integrate par for lane-based execution
- Purpose: Map execution lanes to git worktree-backed par tasks.
- Steps:
  1. Add par as a task orchestration dependency.
  2. Implement lane-to-par-task mapping: each lane maps to a worktree-backed par invocation.
  3. Expose lane create/list/status through par's task model.
  4. Verify parallel lane execution with isolated worktrees.
- Files:
  - `apps/runtime/src/sessions/` (lane/par integration)
- Parallel: Yes (after T000d zellij basics are functional).

### Subtask T000f - Wire zmx checkpoint/restore for session durability basics
- Purpose: Enable basic session checkpoint and restore using zmx.
- Steps:
  1. Add zmx as a session durability dependency.
  2. Implement checkpoint capture for active zellij sessions.
  3. Implement restore from checkpoint on session reattach.
  4. Verify round-trip: checkpoint → kill session → restore → verify state.
- Files:
  - `apps/runtime/src/sessions/` (zmx integration module)
- Parallel: Yes (after T000d zellij basics are functional).

### Subtask T000g - Verify end-to-end: keystroke to PTY to ghostty render to screen with measured latency
- Purpose: Confirm the full input/output pipeline works and establish latency baseline.
- Steps:
  1. Instrument the keystroke-to-render pipeline with timing probes.
  2. Measure: key event → PTY write → PTY read → ghostty render → frame present.
  3. Record p50/p95/p99 latencies for single-character and burst input.
  4. Document baseline metrics and acceptable thresholds.
- Files:
  - `apps/desktop/src/` (instrumentation)
  - `apps/runtime/src/` (timing probes)
  - Metrics output artifact
- Parallel: No.

### Subtask T000h - [P] Add baseline integration tests for fork bootstrap
- Purpose: Lock the fork's build, render, and session primitives with automated tests.
- Steps:
  1. Add build verification test (fork compiles, binary launches).
  2. Add PTY spawn + ghostty render smoke test.
  3. Add zellij session create/attach round-trip test.
  4. Add par lane creation test with worktree isolation check.
- Files:
  - `apps/runtime/tests/integration/bootstrap/`
  - `apps/desktop/tests/`
- Parallel: Yes.

## Test Strategy

- Build verification: fork compiles and launches without editor/browser pane artifacts.
- Renderer smoke: ghostty renders PTY output correctly in the ElectroBun window.
- Session round-trip: zellij create → attach → checkpoint → restore succeeds.
- Lane isolation: par tasks run in isolated git worktrees.
- Latency baseline: end-to-end keystroke-to-frame latency is measured and recorded.

## Risks & Mitigations

- Risk: ElectroBun build breaks after aggressive surface reduction.
- Mitigation: incremental removal with build verification after each deletion pass.
- Risk: Ghostty integration complexity (library vs subprocess, platform-specific rendering).
- Mitigation: start with subprocess integration as fallback; iterate toward library embedding.
- Risk: Zellij/zmx version incompatibilities or API instability.
- Mitigation: pin versions at fork time; wrap integration behind adapter interfaces.

## Review Guidance

- Confirm no editor/browser pane remnants in the main stage layout.
- Confirm ghostty renders real PTY output (not mock/placeholder).
- Confirm zellij sessions are controllable from the runtime layer.
- Confirm par lanes map to actual git worktrees.
- Confirm latency metrics are captured and documented.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created as Phase 0 prerequisite.
- 2026-03-01T13:42:02Z – unknown – lane=done – Bootstrap complete
