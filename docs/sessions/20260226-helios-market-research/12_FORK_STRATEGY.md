# Fork Strategy: co(lab) Week 1

Date: 2026-02-26
Target Base: `blackboardsh/colab`
Objective: Use co(lab) as acceleration base while stripping non-core surfaces for Helios terminal-first architecture.

## Helios Lock (Reference)

- Shell: ElectroBun
- Renderers: ghostty + rio (feature-flagged)
- Worktree/lane orchestrator: par
- Mux core: zellij
- Durability/collab: zmx + upterm + tmate
- Protocols: ACP + MCP + A2A + internal local bus

## Week 1 Goals

1. Establish fork and compile baseline.
2. Remove editor/browser-heavy UX from hot path.
3. Install Helios runtime boundary and protocol spine.
4. Preserve only reusable shell/workspace/settings primitives.

## Keep / Rewrite / Delete Matrix

### KEEP (as-is or light adaptation)

- Desktop shell bootstrap, window lifecycle, app settings persistence.
- Command palette scaffolding and global keyboard routing foundation.
- Workspace/project container and navigation primitives.
- Plugin loading skeleton only if it is decoupled and lazy-loaded.
- Basic telemetry/event dispatch plumbing (if non-blocking).

### REWRITE (required for Helios)

- Main-stage layout:
  - rewrite to terminal-first canvas + lanes/panes/tabs model.
- Runtime boundary:
  - replace existing runtime coupling with local bus contract (`helios.localbus.v1`).
- Task/workspace orchestration:
  - integrate `par` lane lifecycle instead of co(lab)-native workflow model.
- Session runtime:
  - integrate `zellij` + `zmx` lifecycle.
- Collaboration flow:
  - add `upterm`/`tmate` share controls and policy gates.
- AI integration layer:
  - adapt to ACP client boundary + MCP tool bridge + A2A external federation.
- Renderer subsystem:
  - implement dual adapter model for `ghostty` and `rio` with switch semantics.

### DELETE (week-1 hard cuts)

- Browser/editor-first panes in primary workspace.
- Heavy DOM-rich/editor models that are not required for terminal/chat surfaces.
- Any synchronous indexing/render work on UI thread in terminal hot path.
- Non-essential starter/app-builder flows not tied to Helios runtime core.
- Optional novelty modules that increase startup/memory without helping lane/session control.

## Week 1 Execution Plan

### Day 1: Fork Baseline and Safety

- Fork/import co(lab) into Helios workspace path.
- Add branch protection and baseline CI smoke checks.
- Capture startup/memory baseline metrics before changes.

### Day 2: Surface Reduction

- Remove editor/browser primary surfaces.
- Stand up terminal-first shell layout placeholders:
  - left rail (workspaces/lanes)
  - center terminal canvas
  - right rail (approvals/diff/audit)

### Day 3: Protocol Spine

- Wire local bus envelope/method/topic definitions.
- Connect UI state transitions to local bus events.
- Stub ACP/MCP/A2A boundaries as adapters.

### Day 4: Runtime Integrations

- Add wrappers and adapter contracts for:
  - `par`
  - `zellij`
  - `zmx`
  - `upterm`
  - `tmate`
- Implement lane/session state machine wiring.

### Day 5: Renderer Split

- Implement renderer adapter interface.
- Add `renderer_engine` setting + switch command path.
- Support hot swap attempt with restart fallback.

### Day 6: Perf Pass 1

- Add frame-time and input-to-render instrumentation.
- Apply buffer bounds/backpressure and lazy panel mount rules.
- Verify no heavy non-terminal work in hot path.

### Day 7: Stabilize and Review

- Produce week-1 report with:
  - diff summary (kept/rewritten/deleted)
  - perf deltas
  - known blockers

## Hard Guardrails

- No feature additions outside locked Helios stack during week 1.
- No direct dependency on distributed orchestration in PTY hot path.
- No unbounded terminal or event buffers.
- No share-session defaults without policy gate.

## Acceptance Criteria (End of Week 1)

1. Fork builds and runs with Helios terminal-first shell.
2. Local bus events drive core UI state.
3. Adapter stubs for par/zellij/zmx/upterm/tmate in place and callable.
4. Renderer feature flag available and wired to switch path.
5. Editor/browser-heavy modules removed from primary interaction path.
6. Baseline performance report produced for next optimization wave.
