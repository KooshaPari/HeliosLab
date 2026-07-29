# Runtime Performance Architecture

Date: 2026-02-26

## Objective

Define a low-overhead runtime architecture for Helios as an editor-disabled IDE shell where primary interactions are:
- agent chat UI (control plane)
- direct PTY terminal UI (data plane)

## Performance SLOs

- Input-to-echo latency (p50): <30 ms
- Input-to-render latency (p50): <60 ms
- Renderer frame stability: 60 FPS target on active pane, graceful degradation under bursts
- Concurrent terminals: 25 active sessions with no sustained UI lockup
- Memory (steady-state): <500 MB for reference workload profile

## Architecture Principles

1. Split control plane and terminal data plane.
2. Keep PTY byte path off the main UI thread.
3. Use bounded buffers and explicit backpressure.
4. Render only what is visible and relevant.
5. Treat policy/audit as asynchronous side effects, not hot-path blockers.

## Process and Thread Model

- Desktop host process (`ElectroBun`):
  - window lifecycle
  - settings and feature flags
  - command palette and global UX state

- Runtime daemon process:
  - local bus server (`helios.localbus.v1`)
  - lane/session orchestrator (`par`, `zellij`, `zmx`)
  - protocol adapters (`ACP`, `MCP`, `A2A`)

- Terminal renderer worker(s):
  - active renderer backend (`ghostty` or `rio`)
  - PTY stream decoding and paint scheduling

- Optional share workers:
  - `upterm`, `tmate` lifecycle

## Data Path Diagram

```text
User keystroke
  -> UI input handler
  -> terminal input queue (bounded)
  -> PTY write
  -> PTY output bytes
  -> renderer worker decode
  -> paint queue (frame-coalesced)
  -> GPU draw
  -> screen
```

Hot-path rule:
- No policy, MCP, A2A, or audit work in this path.

## Control Path Diagram

```text
User action (run task / approve / share / switch renderer)
  -> local bus command
  -> runtime service handler
  -> adapter invocation (par/zellij/zmx/upterm/tmate/ACP/MCP/A2A)
  -> local bus events
  -> AG-UI mapping
  -> UI panels (timeline, approvals, status)
```

Control-path rule:
- High-value events are structured and correlated, but do not block PTY rendering.

## Per-Stage Latency Budget

### Terminal input to frame

- UI input capture: 1-3 ms
- Input queue + PTY write: 1-5 ms
- PTY processing and decode: 3-12 ms
- Paint scheduling and composition: 4-20 ms
- Total target: 10-40 ms typical, <=60 ms p50 envelope

### Command operations (non-hot-path)

- Local bus dispatch: <=5 ms
- Policy check: <=10 ms
- Adapter invocation overhead (excluding external tool runtime): <=15 ms
- UI state propagation: <=20 ms

## Frame Pipeline Rules

1. Frame-coalesce terminal updates to avoid repaint storms.
2. Drop intermediate paint events during extreme bursts; keep latest state.
3. Use dirty-region rendering where backend supports it.
4. Inactive panes/tabs are not continuously repainted.

## Buffering and Backpressure

- Per-terminal output ring buffer with hard cap.
- Shared global high-watermark to prevent memory runaway.
- Backpressure stages:
  1. compress paint events
  2. truncate non-visible historical output
  3. surface "render throttled" indicator

Do not:
- block PTY process for UI pressure unless system safety threshold exceeded.

## Renderer Switching Architecture (`ghostty` / `rio`)

### Switch states
- `idle`
- `switching`
- `rollback`
- `failed`

### Sequence

1. Freeze paint ingestion briefly.
2. Snapshot visible terminal state metadata.
3. Initialize target renderer.
4. Rebind PTY streams and replay visible buffer.
5. Resume paint pipeline.

Fallback:
- if any step fails, rollback to previous renderer.
- if hot swap unsupported, perform fast restart with `zmx` + `zellij` restore.

## Lane and Session Performance (`par` + `zellij` + `zmx`)

- Lane creation should avoid redundant clone work where possible.
- Lane attach should be O(1) by session key lookup.
- `zmx` checkpoint frequency should be adaptive:
  - high activity: less frequent checkpoints
  - idle/transition points: immediate checkpoint

## Collaboration Overhead (`upterm` / `tmate`)

- Share-session workers start on-demand only.
- No background share daemon per terminal by default.
- Enforce TTL and auto-stop to limit resource and security footprint.

## Memory Budget Allocation (Reference)

- Desktop host + UI state: 80-140 MB
- Runtime daemon + orchestration: 70-120 MB
- Renderer workers and buffers: 120-180 MB
- 25 terminal PTY/session overhead: 80-140 MB
- Collaboration/process overhead: 20-40 MB

Target total range: 370-620 MB

Note:
- To stay under 500 MB, aggressive buffer bounds and inactive-lane hibernation are required.

## Instrumentation Requirements

Record at minimum:
- input_to_echo_ms
- input_to_render_ms
- frame_time_ms_p50/p95
- renderer_queue_depth
- terminal_output_backlog_bytes
- lane_create_time_ms
- session_restore_time_ms
- memory_rss_mb

## Fault and Recovery Strategy

- Renderer crash: restart renderer worker, rebind PTY streams, emit incident event.
- Runtime daemon crash: restart daemon and restore lanes from `zmx` + `zellij` metadata.
- Adapter failure (`par`/`upterm`/`tmate`): isolate to lane-level error, never crash global runtime.

## Implementation Guardrails

1. No synchronous disk IO in PTY render loop.
2. No JSON serialization/deserialization of full terminal output frames in UI thread.
3. No unbounded arrays for event timelines or terminal history.
4. Policy, audit, and analytics must be async and cancellable.

## Verification Gates

- Gate A: 8-terminal profile must sustain p50 input-to-render <45 ms.
- Gate B: 16-terminal profile must sustain p50 <55 ms with no sustained frame collapse.
- Gate C: 25-terminal profile must sustain p50 <60 ms and memory <=500 MB median over soak window.
