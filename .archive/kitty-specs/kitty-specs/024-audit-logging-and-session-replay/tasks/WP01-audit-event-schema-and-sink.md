---
work_package_id: WP01
title: Audit Event Schema and Append-Only Sink
lane: "done"
dependencies: []
base_branch: main
base_commit: c0c76ff4c8f9336ace18d5c5929a53f91b36e7a8
created_at: '2026-03-01T13:29:53.391826+00:00'
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 1 - Audit Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "55466"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Audit Event Schema and Append-Only Sink

## Objectives & Success Criteria

- Define the structured audit event schema with all fields required for forensic analysis.
- Implement an append-only sink that never blocks command execution and never drops events.
- Subscribe to bus events for automatic audit capture.

Success criteria:
- All audit events conform to the defined schema with required fields.
- Write latency < 5ms (p95) to avoid blocking command execution.
- Zero events dropped under simulated backpressure or write failures.
- Bus subscription captures lifecycle events automatically.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/spec.md`

Constraints:
- Async writes; never block the hot path.
- Append-only: no mutation or deletion except via retention purge.
- Events must never be dropped; buffer on failure and retry.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Define AuditEvent schema

- Purpose: Establish the immutable record format for all audit events, providing the foundation for the entire audit system.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/event.ts`.
  2. Define `AuditEvent` interface with all required fields:
     - `id`: unique string (UUID v7 for time-ordered generation)
     - `eventType`: string categorization (e.g., `"command.executed"`, `"policy.evaluation"`, `"session.created"`, `"terminal.output"`, `"approval.resolved"`)
     - `actor`: string identifying who performed the action (agent ID, operator ID, or system)
     - `action`: string describing what was done (e.g., `"execute"`, `"create"`, `"approve"`, `"deny"`)
     - `target`: string identifying what was affected (file path, session ID, command text)
     - `result`: string (e.g., `"success"`, `"failure"`, `"denied"`, `"timeout"`)
     - `timestamp`: ISO 8601 with millisecond precision
     - `workspaceId`: string
     - `laneId`: optional string
     - `sessionId`: optional string
     - `correlationId`: string linking related events across the system
     - `metadata`: Record<string, unknown> for event-type-specific data
  3. Define `AuditEventInput` type for creating events (omitting auto-generated fields like `id` and `timestamp`).
  4. Implement `createAuditEvent(input: AuditEventInput): AuditEvent` factory function that generates the ID (UUID v7) and timestamp.
  5. Implement `validateAuditEvent(event: AuditEvent): boolean` that checks all required fields are present and correctly typed.
  6. Define event type constants for all known event categories to prevent typos.
  7. Add JSDoc documentation for every field and type.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/event.ts`
- Acceptance:
  - Schema covers all required fields per spec FR-024-001.
  - Factory function generates valid events.
  - Validation catches malformed events.
  - All types documented.
- Parallel: No.

### Subtask T002 - Implement append-only AuditSink

- Purpose: Provide the write interface for audit events with guaranteed delivery and non-blocking behavior.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/sink.ts`.
  2. Define `AuditSink` interface:
     - `write(event: AuditEvent): Promise<void>` — async, non-blocking, never throws (buffers on failure).
     - `flush(): Promise<void>` — force-flush any buffered events.
     - `getBufferedCount(): number` — return count of events waiting to be persisted.
  3. Implement `DefaultAuditSink` class:
     - Maintain an in-memory write buffer (bounded array, configurable max size, e.g., 10,000 events).
     - On `write()`: add event to buffer, trigger async persistence (do not await).
     - If persistence fails: keep event in buffer, schedule retry with exponential backoff.
     - If buffer is full: trigger immediate overflow to persistent storage (WP02); if overflow also fails, log a critical alert but NEVER drop the event (expand buffer temporarily).
     - On `flush()`: persist all buffered events synchronously.
  4. Add metrics: total events written, buffer high-water mark, persistence failures, retry count.
  5. Ensure `write()` returns in < 1ms (just buffer append, not persistence).
  6. The sink delegates actual persistence to a storage backend (provided by WP02); for now, use a no-op or in-memory storage placeholder.
  7. Export the sink for use by all audit producers.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/sink.ts`
- Acceptance:
  - `write()` is non-blocking (< 1ms).
  - Events are never dropped (buffer expands if needed).
  - Flush persists all buffered events.
  - Metrics track buffer health.
- Parallel: No.

### Subtask T003 - Subscribe AuditSink to local bus for automatic capture

- Purpose: Ensure all lifecycle events published on the local bus are automatically captured as audit events without manual instrumentation in every producer.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/bus-subscriber.ts`.
  2. Define a mapping from bus event topics to audit event types:
     - `lane.*` events -> `"lane.lifecycle"` audit events
     - `session.*` events -> `"session.lifecycle"` audit events
     - `terminal.*` events -> `"terminal.lifecycle"` audit events
     - `policy.*` events -> `"policy.evaluation"` audit events
     - `approval.*` events -> `"approval.lifecycle"` audit events
  3. Subscribe to all mapped bus topics.
  4. For each received bus event, extract the relevant fields (actor, action, target, context IDs, correlation ID) and create an AuditEvent via the factory function.
  5. Write the AuditEvent to the AuditSink.
  6. Handle unrecognized bus topics: log a warning but do not crash; optionally create a generic audit event.
  7. Ensure the subscription does not block the bus event dispatch (async handler).
  8. Wire the subscriber into the runtime initialization so it starts capturing events from boot.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/bus-subscriber.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts` (wire subscriber at startup)
- Acceptance:
  - Bus events are automatically captured as audit events.
  - Topic-to-event-type mapping covers all known topics.
  - Subscription is non-blocking.
  - Unknown topics handled gracefully.
- Parallel: No.

### Subtask T004 - Add unit tests for event schema, sink, and bus subscriber

- Purpose: Lock the audit foundation behavior before building higher-level features.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/event.test.ts`:
     - Test: factory function creates valid events with all required fields.
     - Test: missing required fields (actor, action, target) are caught by validation.
     - Test: UUID v7 IDs are time-ordered (event created later has lexicographically greater ID).
     - Test: metadata field accepts arbitrary key-value pairs.
  2. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/sink.test.ts`:
     - Test: `write()` returns in < 1ms (non-blocking).
     - Test: write 10,000 events, flush, verify all persisted (using mock storage).
     - Test: simulate storage failure, verify events buffered and not lost.
     - Test: simulate storage recovery, verify buffered events are persisted on retry.
     - Test: buffer high-water mark metric tracks correctly.
     - Test: p95 write latency < 5ms benchmark.
  3. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/bus-subscriber.test.ts`:
     - Test: bus event for `lane.created` topic produces a `lane.lifecycle` audit event.
     - Test: bus event for `policy.evaluation.completed` produces a `policy.evaluation` audit event.
     - Test: unknown bus topic produces warning log but no crash.
     - Test: correlation ID is preserved from bus event to audit event.
  4. Ensure all tests are deterministic and run via `bun test`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/event.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/sink.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/bus-subscriber.test.ts`
- Acceptance:
  - All tests pass.
  - Coverage of happy path, error paths, and edge cases.
  - Performance benchmarks pass.
- Parallel: Yes (after T001-T003 interfaces are stable).

## Test Strategy

- Unit tests for schema validation and factory functions.
- Sink tests with mock storage backend.
- Bus subscriber tests with mock bus.
- Performance benchmarks for write latency.

## Risks & Mitigations

- Risk: High event throughput overwhelms the buffer.
- Mitigation: Bounded backpressure with overflow to persistent storage; critical alerts on buffer growth.
- Risk: Storage backend not yet implemented (WP02).
- Mitigation: Use mock/no-op storage; sink is decoupled from storage backend.

## Review Guidance

- Confirm all required audit event fields are present.
- Confirm sink never blocks (< 1ms write, < 5ms p95 including async persistence).
- Confirm events are never dropped (verify buffer behavior under failure).
- Confirm bus subscriber covers all known topic categories.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:29:54Z – claude-haiku – shell_pid=55466 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:32:03Z – claude-haiku – shell_pid=55466 – lane=done – Implemented: Audit event schema, sink with non-blocking write, bus subscriber, and comprehensive unit tests
