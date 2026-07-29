---
work_package_id: WP02
title: Storage Layer — Ring Buffer and SQLite Persistence
lane: "done"
dependencies:
- WP01
base_branch: 024-audit-logging-and-session-replay-WP01
base_commit: 23250f22b35e5eea258e6fcd559f8bc87656ae52
created_at: '2026-03-01T13:32:18.537580+00:00'
subtasks:
- T005
- T006
- T007
- T008
phase: Phase 1 - Audit Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "66147"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Storage Layer — Ring Buffer and SQLite Persistence

## Objectives & Success Criteria

- Implement in-memory ring buffer for sub-millisecond reads on recent events.
- Implement SQLite persistence for durable 30+ day retention.
- Ensure ring buffer overflow spills to SQLite without event loss.
- Validate zero event loss under crash scenarios.

Success criteria:
- Ring buffer provides < 1ms read access for recent events.
- SQLite stores 30 days of events at 100k/day within 500 MB.
- Overflow from ring buffer to SQLite loses zero events.
- Simulated crash and restart recovers all persisted events.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/spec.md`
- WP01 output: AuditEvent schema, AuditSink interface.

Constraints:
- Ring buffer capacity is configurable (default: 10,000 events).
- SQLite must use WAL mode for concurrent reads/writes.
- Writes never block reads.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T005 - Implement in-memory ring buffer

- Purpose: Provide fast read access to the most recent audit events for hot queries and real-time UI updates.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ring-buffer.ts`.
  2. Implement `AuditRingBuffer` class with configurable capacity (default 10,000).
  3. Use a fixed-size array with head/tail pointers for O(1) append and O(1) random access by index.
  4. Implement `push(event: AuditEvent)`: append to buffer; if full, return the evicted event (oldest) for overflow handling.
  5. Implement `getRecent(count: number): AuditEvent[]`: return the N most recent events.
  6. Implement `query(filter: AuditFilter): AuditEvent[]`: filter events in the buffer by workspace, lane, session, actor, event type, time range.
  7. Implement `getByCorrelationId(correlationId: string): AuditEvent[]`: return all events with the given correlation ID.
  8. All read operations must complete in < 1ms for a full 10,000-event buffer.
  9. The buffer must be thread-safe if concurrent access is possible (Bun is single-threaded for JS, but verify).
  10. Add capacity and current size metrics.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ring-buffer.ts`
- Acceptance:
  - O(1) append and eviction.
  - < 1ms read for queries on full buffer.
  - Evicted events returned for overflow handling.
  - Metrics available.
- Parallel: No.

### Subtask T006 - Implement SQLite persistence layer

- Purpose: Provide durable, indexed storage for audit events supporting 30+ days of retention.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/sqlite-store.ts`.
  2. Use `bun:sqlite` for the database connection.
  3. Create table schema: `audit_events` with columns matching `AuditEvent` fields. Use `id` as primary key.
  4. Create indexes on: `workspace_id`, `lane_id`, `session_id`, `actor`, `event_type`, `correlation_id`, `timestamp`.
  5. Enable WAL mode for concurrent read/write access.
  6. Implement `persist(events: AuditEvent[])`: batch insert events for efficiency.
  7. Implement `query(filter: AuditFilter, options: { limit, offset }): AuditEvent[]`: indexed query with all filter dimensions.
  8. Implement `getByCorrelationChain(correlationId: string): AuditEvent[]`: follow correlation ID chains.
  9. Implement `count(filter?: AuditFilter): number`: count matching events.
  10. Implement `getStorageSize(): number`: return SQLite file size in bytes.
  11. Add database migration logic: create table and indexes on first run; versioned migrations for schema evolution.
  12. Handle database corruption gracefully: detect, log critical error, attempt recovery.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/sqlite-store.ts`
- Acceptance:
  - Batch inserts are efficient (> 1000 events/second).
  - Queries use indexes and return within 500ms for 1M events.
  - WAL mode enables concurrent reads/writes.
  - Storage size trackable.
- Parallel: No.

### Subtask T007 - Implement ring buffer overflow to SQLite

- Purpose: Ensure events evicted from the ring buffer are persisted to SQLite without loss.
- Steps:
  1. Modify the `AuditSink` (from WP01) to use both the ring buffer and SQLite store.
  2. On `write()`:
     a. Push the event to the ring buffer.
     b. If the ring buffer returns an evicted event, immediately persist it to SQLite.
     c. Periodically flush all ring buffer contents to SQLite (configurable interval, default 10 seconds).
  3. On `flush()`: persist all current ring buffer events to SQLite.
  4. Ensure the overflow path is atomic: either the event is in the ring buffer OR in SQLite, never lost between them.
  5. Handle SQLite write failures during overflow: buffer overflow events in a secondary queue and retry.
  6. Add overflow metrics: events overflowed, SQLite write failures, retry count.
  7. Test: fill ring buffer to capacity + 100, verify all 100 overflow events are in SQLite.
  8. Test: simulate SQLite failure during overflow, verify events are queued for retry.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/sink.ts` (integrate storage)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ring-buffer.ts` (overflow hook)
- Acceptance:
  - Zero events lost during overflow.
  - SQLite failures handled with retry.
  - Periodic flush ensures durability.
  - Overflow metrics available.
- Parallel: No.

### Subtask T008 - Storage chaos tests

- Purpose: Validate zero event loss under crash and overflow scenarios using real SQLite operations.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/storage-chaos.test.ts`.
  2. Test: write 50,000 events, flush, restart (simulate by creating new sink instance with same SQLite DB), verify all 50,000 events recoverable from SQLite.
  3. Test: write events rapidly (1000/second), verify ring buffer overflow to SQLite loses zero events by comparing counts.
  4. Test: simulate SQLite write failure (e.g., read-only filesystem mock), verify events are buffered and persisted on recovery.
  5. Test: write events, simulate crash (SIGKILL-equivalent: abort without flush), restart, count events in SQLite, verify loss is bounded to unflushed ring buffer contents (acceptable loss documented).
  6. Test: concurrent reads while writes are in progress (WAL mode), verify reads return consistent results.
  7. Test: verify storage size is within 500 MB for 3 million events (30 days at 100k/day).
  8. Use real SQLite (not mocked) for realistic chaos testing.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/storage-chaos.test.ts`
- Acceptance:
  - Zero event loss during normal overflow.
  - Bounded loss during hard crash documented.
  - Concurrent access works correctly.
  - Storage size within 500 MB target.
- Parallel: Yes (after T005-T007 are functional).

## Test Strategy

- Chaos tests with real SQLite for crash and overflow scenarios.
- Performance benchmarks for read/write latency.
- Storage size validation at target event rates.
- Concurrent access tests.

## Risks & Mitigations

- Risk: SQLite WAL file grows large under sustained write pressure.
- Mitigation: Periodic WAL checkpoint; monitor WAL size.
- Risk: Hard crash loses unflushed ring buffer events.
- Mitigation: Reduce flush interval; document acceptable loss window.

## Review Guidance

- Confirm ring buffer overflow spills to SQLite without loss.
- Confirm WAL mode is enabled for concurrent access.
- Confirm chaos tests use real SQLite.
- Confirm storage size is within budget.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:32:19Z – claude-haiku – shell_pid=66147 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:26Z – claude-haiku – shell_pid=66147 – lane=done – Implemented: Ring buffer, SQLite storage with WAL, overflow handling, and chaos tests
