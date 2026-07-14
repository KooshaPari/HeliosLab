---
work_package_id: WP01
title: Switch State Machine and PTY Stream Proxy
lane: "done"
dependencies: []
base_branch: main
base_commit: 20335a842cf793dbdf80a3bc427cc500350946a2
created_at: '2026-03-01T13:29:08.316678+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "53525"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Switch State Machine and PTY Stream Proxy

## Objectives & Success Criteria

- Implement the switch transaction state machine governing all renderer switch operations.
- Implement the renderer capability matrix for querying hot-swap support and version constraints.
- Implement the PTY stream proxy that buffers terminal I/O during the switch window to guarantee zero byte loss.
- Emit lifecycle events for all switch phases on the internal bus.

Success criteria:
- State machine enforces valid transitions only; invalid transitions are rejected with clear errors.
- Capability matrix correctly reports hot-swap support for ghostty and rio adapters.
- PTY proxy buffers and replays without dropped bytes under sustained throughput for up to 8 seconds.
- Lifecycle events fire for switch-started, switch-committed, switch-rolled-back, and switch-failed.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/013-renderer-switch-transaction/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/013-renderer-switch-transaction/spec.md`
- Renderer adapter interface: spec 010 (`apps/runtime/src/renderer/`)
- Ghostty backend: spec 011
- Rio backend: spec 012
- Internal event bus: spec 001 (`apps/runtime/src/protocol/bus.ts`)

Constraints:
- Fail-fast on invalid state transitions; no silent fallback.
- PTY proxy must use bounded ring buffer to prevent memory exhaustion.
- Keep files under 500 lines; split if needed.
- TypeScript + Bun runtime.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement switch transaction state machine
- Purpose: define the authoritative state graph for renderer switch transactions with transition guards.
- Steps:
  1. Define the `SwitchTransactionState` discriminated union type with states: `pending`, `hot-swapping`, `restarting`, `committing`, `rolling-back`, `committed`, `rolled-back`, `failed`.
  2. Implement a `SwitchTransaction` class/module in `apps/runtime/src/renderer/switch_transaction.ts` that:
     a. Holds current state, source renderer ID, target renderer ID, timestamp, and correlation ID.
     b. Exposes `transition(toState)` method with guards that reject invalid transitions (e.g., cannot go from `committed` to `hot-swapping`).
     c. Emits state-change events via a callback or event emitter interface.
     d. Enforces single-transaction-at-a-time: rejects `start()` if a transaction is already active.
  3. Define the valid transition graph as a constant map for easy review and testing.
  4. Add explicit error types for `InvalidTransition` and `ConcurrentTransaction`.
  5. Export the transaction factory and state types for use by WP02/WP03 execution paths.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/switch_transaction.ts`
- Validation:
  - Unit test: instantiate transaction, walk through valid transition sequences, assert state at each step.
  - Unit test: attempt invalid transitions, assert `InvalidTransition` error.
  - Unit test: attempt concurrent transaction, assert `ConcurrentTransaction` error.
- Parallel: No.

### Subtask T002 - Implement renderer capability matrix
- Purpose: provide a queryable interface for renderer hot-swap support and feature constraints.
- Steps:
  1. Define `RendererCapability` interface with fields: `rendererId`, `version`, `supportsHotSwap`, `features` (string array), `constraints` (optional version/platform constraints).
  2. Implement `CapabilityMatrix` in `apps/runtime/src/renderer/capability_matrix.ts` that:
     a. Registers capabilities from renderer adapters (ghostty, rio) on initialization.
     b. Exposes `canHotSwap(sourceId, targetId): boolean` checking both adapters' declarations.
     c. Exposes `getCapabilities(rendererId): RendererCapability` for UI consumption (spec 018).
     d. Exposes `listRenderers(): RendererCapability[]` for settings panel enumeration.
  3. Consume capability declarations from the renderer adapter interface (spec 010).
  4. Return explicit errors for unknown renderer IDs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/capability_matrix.ts`
- Validation:
  - Unit test: register ghostty + rio capabilities, query `canHotSwap` for all permutations.
  - Unit test: query unknown renderer ID, assert clear error.
  - Unit test: verify `listRenderers` returns all registered adapters.
- Parallel: No.

### Subtask T003 - Implement PTY stream proxy with bounded buffering
- Purpose: buffer all PTY I/O during the switch window so no bytes are lost during renderer teardown/init.
- Steps:
  1. Implement `PtyStreamProxy` in `apps/runtime/src/renderer/pty_stream_proxy.ts` that:
     a. Can be inserted between the PTY output stream and the renderer input.
     b. In `passthrough` mode: forwards bytes directly with no buffering overhead.
     c. In `buffering` mode: captures all PTY output into a bounded ring buffer.
     d. Exposes `startBuffering()` to switch from passthrough to buffering mode.
     e. Exposes `replay(target)` to flush the buffer to a new renderer and return to passthrough.
     f. Exposes `abort()` to discard the buffer and return to passthrough with original renderer.
  2. Implement bounded ring buffer with configurable capacity (default: 16MB).
  3. Emit overflow telemetry event if buffer capacity is exceeded; enter degraded mode (drop oldest bytes, flag the proxy as degraded).
  4. Handle backpressure: if the target renderer cannot consume replay fast enough, apply flow control.
  5. Implement per-terminal proxy instances (one proxy per active PTY during the switch).
  6. Export factory function for creating proxy instances.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/pty_stream_proxy.ts`
- Validation:
  - Unit test: write N bytes in buffering mode, replay to mock target, assert all bytes received in order.
  - Unit test: exceed buffer capacity, assert overflow event and degraded flag.
  - Unit test: verify passthrough mode adds negligible overhead (no copy).
  - Integration test: simulate 8-second sustained throughput at typical terminal output rate, verify no drops.
- Parallel: No.

### Subtask T004 - Wire switch lifecycle event emission
- Purpose: emit bus events for switch transaction phase changes so downstream consumers (UI, audit) can react.
- Steps:
  1. Define event topic constants: `renderer.switch.started`, `renderer.switch.committed`, `renderer.switch.rolled_back`, `renderer.switch.failed`.
  2. Define event payload schema with fields: `transactionId`, `sourceRenderer`, `targetRenderer`, `phase`, `timestamp`, `correlationId`, `error` (optional).
  3. Wire `SwitchTransaction` state-change callback to publish events on the internal bus (`apps/runtime/src/protocol/bus.ts`).
  4. Add correlation ID propagation from the switch request through all emitted events.
  5. Register event topics in the protocol topic registry if applicable.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/renderer/switch_transaction.ts` (wire events)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts` (topic registration if needed)
- Validation:
  - Unit test: walk through a complete switch lifecycle, assert all four event types are emitted with correct payloads.
  - Unit test: verify correlation ID is consistent across all events in a single transaction.
- Parallel: No.

### Subtask T005 - Add unit tests for state machine, capability matrix, and PTY proxy
- Purpose: lock behavior before hot-swap and restart-with-restore execution paths are built.
- Steps:
  1. Create test files:
     a. `apps/runtime/tests/unit/renderer/switch_transaction.test.ts`
     b. `apps/runtime/tests/unit/renderer/capability_matrix.test.ts`
     c. `apps/runtime/tests/unit/renderer/pty_stream_proxy.test.ts`
  2. For state machine tests:
     a. Test all valid transition paths (happy path through hot-swap, happy path through restart, rollback paths).
     b. Test all invalid transitions (every disallowed state pair).
     c. Test concurrent transaction rejection.
     d. Test event emission on each transition.
  3. For capability matrix tests:
     a. Test registration, query, hot-swap compatibility check.
     b. Test unknown renderer error handling.
  4. For PTY proxy tests:
     a. Test passthrough mode (bytes forwarded immediately).
     b. Test buffering mode (bytes captured, none forwarded).
     c. Test replay (all buffered bytes delivered to target in order).
     d. Test overflow behavior (bounded buffer, telemetry event).
     e. Test abort (buffer discarded, original renderer restored).
  5. Use Vitest; aim for >=90% line coverage on these modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/renderer/switch_transaction.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/renderer/capability_matrix.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/renderer/pty_stream_proxy.test.ts`
- Parallel: Yes (after T001/T002/T003 interfaces are stable).

## Test Strategy

- Run unit tests via Vitest/Bun.
- State machine tests use exhaustive transition tables.
- PTY proxy tests use synthetic byte streams with deterministic content.
- Aim for >=90% line coverage on all three modules.

## Risks & Mitigations

- Risk: PTY buffer overflow under heavy terminal output during long switch windows.
- Mitigation: bounded ring buffer with configurable capacity and explicit overflow telemetry.
- Risk: state machine allows invalid transitions due to missing guards.
- Mitigation: exhaustive transition table tests covering every state pair.

## Review Guidance

- Confirm state machine transition graph is complete and matches spec states.
- Confirm PTY proxy buffering/replay preserves byte order and completeness.
- Confirm capability matrix consumes adapter declarations correctly.
- Confirm lifecycle events carry correct correlation IDs.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:08Z – claude-haiku – shell_pid=53525 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:30:57Z – claude-haiku – shell_pid=53525 – lane=done – Implemented: Switch state machine, capability matrix, PTY stream proxy, and lifecycle event emission with comprehensive unit tests (54 tests passing)
