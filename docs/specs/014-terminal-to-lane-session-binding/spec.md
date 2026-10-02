# Terminal To Lane Session Binding

## Overview

The runtime built by `createRuntime()` is a bus-mediated simulation of a
terminal: it appends output to an in-memory `TerminalBuffer` and publishes
events, but no process is ever spawned and no renderer is ever reached. The
PTY, lane, and renderer layers exist as complete libraries
(`apps/runtime/src/pty`, `apps/runtime/src/lanes`,
`apps/runtime/src/renderer`) with no in-process consumer.

This feature supplies that consumer: a driver that binds a lane to a real PTY
process and pipes the process's output into a renderer surface. It is the
smallest end-to-end path that makes HeliosLab a terminal-first agent IDE
rather than an event bus with no terminals attached.

## Requirements

### FR-014-001 — Lane creation materialises a terminal

When a lane reaches `created`, exactly one PTY process must be spawned for that
lane and bound to the active renderer surface. A repeated `lane.created` for a
lane that already owns a live PTY must not spawn a second process.

### FR-014-002 — PTY output reaches a renderer surface

Bytes written by the PTY process must be relayed, unmodified and in order, to
the renderer bound to that PTY. Output must not be cross-wired between lanes.

### FR-014-003 — Lane cleanup detaches the renderer

When a lane reaches `cleaned` or `closed`, its PTY stream must be unbound from
the renderer and the PTY terminated. After unbinding, no further output from
that PTY may be delivered to the renderer.

### FR-014-004 — Spawn failures are reported, not thrown

A lane whose PTY cannot be spawned must leave the runtime running and surface a
structured error identifying the lane. One lane's spawn failure must not affect
other lanes.

### FR-014-005 — Headless renderer surface

A renderer adapter that performs no GPU work and records received output must
be available so the binding can be exercised in CI and headless mode.

## Design

The driver is strictly additive. It subscribes to the lifecycle topics that
`LaneLifecycleService` already publishes on the local bus:

```
lane.create  -> lane.created            -> PtyManager.spawn
                                        -> StreamBindingManager.bind
lane.cleanup -> lane.cleaned / closed   -> StreamBindingManager.unbind
                                        -> PtyManager.terminate
```

`LaneLifecycleService` (`sessions/`) and `LaneManager` (`lanes/`) are parallel
abstractions at different layers: the former is an I/O-free command-handler
service, the latter a worktree-aware orchestrator. The driver consumes the
former's event stream, so the existing runtime path is unchanged.

Two defects in the supporting layers were fixed as part of this feature,
because without them the binding cannot function:

- `spawnPty` did not return the spawned process handle, so a PTY's `stdout`
  was unreachable and no output could ever reach a renderer.
- `InMemoryLocalBus.subscribe()` was a no-op returning `() => {}`, so no
  subscriber could observe any event the runtime published.

## Status

Implemented. Tracked in AgilePlus. See
`tasks/WP01-terminal-first-vertical-slice.md`.
