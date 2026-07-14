---
work_package_id: WP03
title: Searchable Ledger and Filtering API
lane: "done"
dependencies:
- WP02
base_branch: 024-audit-logging-and-session-replay-WP02
base_commit: c3003b5354b8a4232e87053fc5731dadad357570
created_at: '2026-03-01T13:34:36.641585+00:00'
subtasks:
- T009
- T010
- T011
- T012
- T013
phase: Phase 2 - Audit Querying
assignee: ''
agent: "claude-haiku"
shell_pid: "76365"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 - Searchable Ledger and Filtering API

## Objectives & Success Criteria

- Implement the searchable audit ledger with multi-dimensional filtering.
- Support correlation ID chain traversal for cross-lane/session debugging.
- Deliver real-time ledger updates via bus subscription.
- Expose ledger queries through runtime API endpoints.

Success criteria:
- Queries return matching events within 500ms (p95) for datasets up to 1 million events.
- Correlation ID search returns the complete event chain for 99.9% of traced operations.
- Real-time updates push new matching events to active queries without polling.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/spec.md`
- WP02 output: Ring buffer, SQLite store.

Constraints:
- Search latency < 500ms (p95) for 1M events.
- Correlation chain traversal must be complete (99.9% accuracy).
- Real-time updates via bus, not polling.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP03`

## Subtasks & Detailed Guidance

### Subtask T009 - Implement AuditLedger with multi-dimensional filtering

- Purpose: Provide a high-level query interface over the audit storage that supports all spec-required filter dimensions.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ledger.ts`.
  2. Define `AuditFilter` interface:
     - `workspaceId`: optional string
     - `laneId`: optional string
     - `sessionId`: optional string
     - `actor`: optional string
     - `eventType`: optional string or string[]
     - `correlationId`: optional string
     - `timeRange`: optional `{ from: Date, to: Date }`
     - `limit`: number (default 100, max 1000)
     - `offset`: number (default 0)
  3. Implement `AuditLedger` class that:
     - First checks the ring buffer for recent events matching the filter.
     - Falls back to SQLite for historical events.
     - Merges results from both sources, deduplicating by event ID.
     - Returns events in chronological order.
  4. Implement `search(filter: AuditFilter): AuditEvent[]` as the primary query method.
  5. Implement `count(filter: AuditFilter): number` for result count without full data.
  6. Optimize query execution: use SQLite indexes for all filterable dimensions; skip SQLite for time-range queries where all results are within ring buffer window.
  7. Add query timing metrics.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ledger.ts`
- Acceptance:
  - All filter dimensions work correctly.
  - Results merged from ring buffer and SQLite with deduplication.
  - Chronological ordering maintained.
  - Query timing < 500ms (p95) for 1M events.
- Parallel: No.

### Subtask T010 - Implement correlation ID chain traversal

- Purpose: Enable operators to trace a complete chain of related events across lanes and sessions for debugging and incident response.
- Steps:
  1. In `AuditLedger`, implement `getCorrelationChain(correlationId: string): AuditEvent[]`.
  2. Start from the given correlation ID, query all events with that ID.
  3. If any returned events reference a parent correlation ID (via metadata), recursively follow the chain.
  4. Return the complete chain in chronological order.
  5. Handle circular references: track visited correlation IDs and break cycles with a warning.
  6. Handle broken chains: log a warning if a referenced correlation ID has no matching events.
  7. Optimize: pre-fetch likely related events based on workspace/lane/session context.
  8. Test: create a chain of 10 correlated events across 3 lanes, traverse from the last event, verify all 10 returned in order.
  9. Test: broken chain (missing middle event) returns available events with warning.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ledger.ts` (add method)
- Acceptance:
  - Complete chains returned for 99.9% of traced operations.
  - Circular references handled gracefully.
  - Broken chains produce warnings but do not crash.
  - Results in chronological order.
- Parallel: No.

### Subtask T011 - Implement real-time ledger updates

- Purpose: Enable the UI to show new matching events as they arrive without polling.
- Steps:
  1. In `AuditLedger`, implement a subscription mechanism:
     - `subscribe(filter: AuditFilter, callback: (event: AuditEvent) => void): Unsubscribe`.
  2. The ledger subscribes to the bus for new audit events.
  3. For each new event, check it against all active filter subscriptions.
  4. If the event matches a subscription's filter, invoke the callback with the event.
  5. Ensure callbacks are non-blocking (async invocation).
  6. Implement `Unsubscribe` function to clean up subscriptions.
  7. Handle high event throughput: batch notifications at configurable intervals (e.g., 100ms) to avoid overwhelming the UI.
  8. Test: subscribe with a workspace filter, emit matching and non-matching events, verify only matching events are delivered.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/ledger.ts` (add subscription)
- Acceptance:
  - Real-time updates for matching events.
  - Non-matching events not delivered.
  - Subscriptions cleanly removable.
  - Batched delivery for performance.
- Parallel: No.

### Subtask T012 - Create ledger query API endpoints

- Purpose: Expose the audit ledger to the desktop UI and external consumers via runtime API.
- Steps:
  1. Add ledger query endpoints to the runtime API surface (following the existing pattern in `apps/runtime/src/`):
     - `GET /audit/events` — search with filter parameters (workspace, lane, session, actor, type, time range, correlation ID, limit, offset).
     - `GET /audit/events/:correlationId/chain` — correlation chain traversal.
     - `GET /audit/events/count` — count matching events.
     - `WS /audit/events/subscribe` — WebSocket endpoint for real-time updates with filter.
  2. Parse query parameters and construct `AuditFilter` objects.
  3. Return results as JSON arrays with pagination metadata (total count, offset, limit).
  4. WebSocket endpoint sends new events as JSON messages when they match the subscription filter.
  5. Add request validation: reject invalid filter parameters with clear error messages.
  6. Add rate limiting: max 100 queries/minute per client.
  7. Document the API endpoints with request/response schemas.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/api.ts` (or integrated into existing API router)
- Acceptance:
  - All query endpoints return correct results.
  - WebSocket subscription delivers real-time updates.
  - Pagination works correctly.
  - Invalid parameters rejected with clear errors.
- Parallel: No.

### Subtask T013 - Search performance tests

- Purpose: Validate that ledger search meets the 500ms p95 target for large datasets and that correlation chain traversal is reliable.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/search-performance.test.ts`.
  2. Insert 1 million audit events into SQLite with realistic distribution across 10 workspaces, 50 lanes, 100 sessions.
  3. Benchmark filter queries:
     - Single workspace filter: measure p95 latency, assert < 500ms.
     - Time range filter (1 hour window): measure p95, assert < 500ms.
     - Combined workspace + actor + event type filter: measure p95, assert < 500ms.
     - Correlation ID search: measure p95, assert < 500ms.
  4. Benchmark correlation chain traversal:
     - Create 100 chains of 5-20 events each.
     - Traverse each chain, verify completeness.
     - Measure p95 traversal time, assert < 500ms.
  5. Verify real-time subscription delivery latency: emit event, measure time to callback invocation.
  6. Document all measurements.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/search-performance.test.ts`
- Acceptance:
  - All search queries < 500ms p95 for 1M events.
  - Correlation chain traversal 99.9% complete.
  - Measurements documented.
- Parallel: Yes (after T009-T012 are functional).

## Test Strategy

- Performance benchmarks with 1M event dataset.
- Correlation chain completeness verification.
- Real-time subscription delivery tests.
- API endpoint integration tests.

## Risks & Mitigations

- Risk: SQLite queries are slow without proper indexing.
- Mitigation: Comprehensive indexes on all filter dimensions; EXPLAIN QUERY PLAN verification.
- Risk: Real-time subscription overwhelms the UI with high event throughput.
- Mitigation: Batch notifications at configurable intervals.

## Review Guidance

- Confirm all filter dimensions are supported and indexed.
- Confirm correlation chain traversal handles edge cases.
- Confirm real-time subscriptions are non-blocking.
- Confirm API endpoints are documented and validated.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:34:37Z – claude-haiku – shell_pid=76365 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:35:56Z – claude-haiku – shell_pid=76365 – lane=done – Implemented: Searchable ledger with multi-dimensional filtering, correlation chain traversal, real-time subscriptions, and HTTP API
