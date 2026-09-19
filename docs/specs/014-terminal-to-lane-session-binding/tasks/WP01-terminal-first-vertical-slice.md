---
work_package_id: WP01
title: Terminal-First Vertical Slice
lane: "doing"
dependencies: []
base_branch: fix/restore-org
base_commit: e7e67f99
created_at: '2026-09-19T08:20:00+00:00'
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 2 - Terminal First Slice
assignee: ''
agent: "jcode"
review_status: "pending"
reviewed_by: ''
history:
- timestamp: '2026-09-19T08:20:00Z'
  lane: planned
  agent: jcode
  action: Authored alongside implementation on wbs/terminal-slice
---

# Work Package Prompt: WP01 - Terminal-First Vertical Slice

## Objectives & Success Criteria

- Wire the runtime's lane lifecycle to a real PTY process and a renderer
  surface, end to end.
- Prove the flow `lane.create -> pty.spawn -> renderer.bindStream -> bytes in a
  surface` with an integration test.
- Keep the change strictly additive: the existing runtime path is unchanged.

Success criteria:
- A lane with `created` state owns exactly one live PTY whose stdout is bound to
  a renderer.
- Lane cleanup unbinds the renderer and terminates the PTY; the surface stops
  receiving output.
- A repeated `lane.created` does not spawn a second PTY.
- Concurrent lanes have independent PTYs and do not cross-wire output.

## Context & Constraints

- Spec: `docs/specs/014-terminal-to-lane-session-binding/spec.md`
- Constitution: `docs/reference/constitution.md`
- Existing layers:
  - `apps/runtime/src/pty/` — PTY lifecycle manager
  - `apps/runtime/src/lanes/` — worktree-aware lane orchestrator
  - `apps/runtime/src/renderer/` — renderer adapter interface + backends
  - `apps/runtime/src/protocol/bus/` — local bus
  - `apps/runtime/src/sessions/state_machine.ts` — `LaneLifecycleService`

Constraints:
- Fail-fast in protocol core; the driver must not throw on a per-lane failure.
- Keep files under repository limits (target <=350 lines, hard <=500).
- Subscriber failures must not break lifecycle transitions.

## Subtasks & Detailed Guidance

### Subtask T001 - Expose the PTY process handle
- Purpose: make a spawned PTY's stdout reachable so it can be bound.
- Steps:
  1. Add `PtyProcessHandle` to `pty/io.ts` with optional `stdout`/`stderr`.
  2. Return the handle from `spawnPty` in `SpawnResult`.
  3. Store it in `PtyManager.spawn`; add `getProcess`.
- Files:
  - `apps/runtime/src/pty/io.ts`
  - `apps/runtime/src/pty/spawn.ts`
  - `apps/runtime/src/pty/index.ts`

### Subtask T002 - Implement local bus subscriber dispatch
- Purpose: `InMemoryLocalBus.subscribe` was a no-op; no event could be observed.
- Steps:
  1. Add a `subscribers` map keyed by topic.
  2. Return a real unsubscribe closure.
  3. Dispatch accepted events to subscribers, isolating per-handler failures.
- Files:
  - `apps/runtime/src/protocol/bus/emitter.ts`

### Subtask T003 - Headless recording renderer adapter
- Purpose: a real adapter that records output instead of drawing it.
- Steps:
  1. Implement `RendererAdapter` with no GPU work.
  2. Drain bound streams into ordered `RecordedCell` entries.
  3. Cancel the read on `unbindStream` so the recording freezes.
- Files:
  - `apps/runtime/src/renderer/recording_adapter.ts`

### Subtask T004 - Vertical slice driver + integration test
- Purpose: the consumer that binds lane -> PTY -> renderer.
- Steps:
  1. Subscribe to `lane.created`, `lane.cleaned`, `lane.closed`.
  2. Spawn one PTY per lane; bind stdout via `StreamBindingManager`.
  3. On teardown, unbind then terminate; be idempotent on repeats.
  4. Cover the four FRs with an integration test.
- Files:
  - `apps/runtime/src/runtime/vertical_slice_driver.ts`
  - `apps/runtime/src/runtime/vertical-slice.test.ts`

## Validation

- `bun test apps/runtime/src/runtime/vertical-slice.test.ts` — 4 pass.
- `bun test apps/runtime/tests/unit/protocol/` from repo root — 12 pass.
- `bunx tsc --noEmit` — no new errors beyond the TS4111 baseline.
- `biome check` — clean on all touched files.
