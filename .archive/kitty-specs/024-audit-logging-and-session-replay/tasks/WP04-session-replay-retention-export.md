---
work_package_id: WP04
title: Session Replay UI, Retention, Export, and Tests
lane: "done"
dependencies:
- WP03
base_branch: 024-audit-logging-and-session-replay-WP03
base_commit: 53e54ede247a335018e5db1cd28126295031549f
created_at: '2026-03-01T13:36:08.528223+00:00'
subtasks:
- T014
- T015
- T016
- T017
- T018
- T019
- T020
- T021
phase: Phase 3 - Replay and Compliance
assignee: ''
agent: "claude-haiku"
shell_pid: "82027"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP04 - Session Replay UI, Retention, Export, and Tests

## Objectives & Success Criteria

- Capture session state snapshots for replay reconstruction.
- Deliver a session replay engine with time-indexed random access.
- Deliver a replay UI with play/pause, speed control, and time-scrub.
- Implement retention policies with automated purge and deletion proofs.
- Implement JSON export with redaction hooks.
- Comprehensive chaos, replay, and compliance tests.

Success criteria:
- Session replay reconstructs terminal output for 95%+ of test sessions.
- Time-scrub to a specific timestamp renders terminal state within 200ms.
- Retention purge deletes only expired, non-held events with valid deletion proofs.
- Export produces redacted JSON bundles with zero leaked sensitive values.
- Zero event loss in 24-hour soak test.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/024-audit-logging-and-session-replay/spec.md`
- WP01-03 output: AuditEvent schema, sink, ring buffer, SQLite store, ledger with filters.

Constraints:
- Replay scrub-to-render < 200ms (NFR-024-003).
- Retention must produce deletion audit proofs.
- Export without redaction rules must be blocked.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP04`

## Subtasks & Detailed Guidance

### Subtask T014 - Implement session state snapshot capture

- Purpose: Capture periodic snapshots of terminal state for efficient replay reconstruction.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/snapshot.ts`.
  2. Define `SessionSnapshot` interface:
     - `id`: unique string (UUID)
     - `sessionId`: string
     - `timestamp`: ISO 8601
     - `terminalBuffer`: string (full terminal buffer contents at capture time)
     - `cursorPosition`: `{ row: number, col: number }`
     - `dimensions`: `{ rows: number, cols: number }`
     - `scrollbackPosition`: number
  3. Implement `SnapshotCapture` class:
     - Accept a session reference and snapshot interval (default 30 seconds).
     - Start a timer that captures the current terminal state at each interval.
     - On capture: read the terminal buffer, cursor position, and dimensions from the session's terminal.
     - Create a `SessionSnapshot` object and persist it via the audit sink.
     - Stop capturing when the session ends.
  4. Implement `captureNow(sessionId)` for on-demand snapshot capture (e.g., before critical operations).
  5. Store snapshots in SQLite alongside audit events (separate table `session_snapshots`).
  6. Optimize: diff-based compression between consecutive snapshots if buffer is large.
  7. Handle edge cases: terminal not yet ready (skip capture), session ended mid-capture (discard).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/snapshot.ts`
- Acceptance:
  - Snapshots captured at configurable intervals.
  - On-demand capture available.
  - Snapshots persisted to SQLite.
  - Edge cases handled gracefully.
- Parallel: No.

### Subtask T015 - Implement session replay engine

- Purpose: Reconstruct terminal output from snapshots and events for historical session review.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/replay.ts`.
  2. Define `ReplayStream` interface:
     - `sessionId`: string
     - `snapshots`: ordered array of `SessionSnapshot`
     - `events`: ordered array of `AuditEvent` for the session
     - `startTime`: Date
     - `endTime`: Date
     - `duration`: number (milliseconds)
  3. Implement `ReplayEngine` class:
     - `loadSession(sessionId): ReplayStream`: load all snapshots and events for a session.
     - `getStateAtTime(stream: ReplayStream, timestamp: Date): SessionSnapshot`: find the nearest snapshot before the timestamp, then apply events between the snapshot and timestamp to reconstruct the terminal state.
     - `getTimeline(stream: ReplayStream): TimelineEntry[]`: return an array of significant moments (command executions, errors, approvals) for the time-scrub UI.
  4. Handle missing snapshots: degrade to event-only reconstruction by replaying events from the session start. Log a warning about reduced fidelity.
  5. Handle corrupted snapshots: skip and fall back to the previous valid snapshot.
  6. Optimize: cache recently reconstructed states for smooth scrubbing.
  7. Verify reconstruction accuracy by comparing replay output to actual terminal output for test sessions.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/replay.ts`
- Acceptance:
  - Session replay reconstructs terminal state from snapshots + events.
  - Time-indexed random access works (scrub to any timestamp).
  - Missing/corrupted snapshots handled gracefully.
  - State-at-time renders within 200ms.
- Parallel: No.

### Subtask T016 - Implement session replay UI

- Purpose: Provide an interactive UI for operators to review historical terminal sessions.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/session-replay.ts`.
  2. UI layout:
     - Terminal render area showing the reconstructed terminal state.
     - Time-scrub slider spanning the session duration with tick marks at snapshot intervals.
     - Play/pause button for automated playback.
     - Speed controls: 0.5x, 1x, 2x, 4x playback speed.
     - Timeline bar showing significant events (commands, errors, approvals) as markers.
     - Session metadata: session ID, workspace, lane, start/end times, duration.
  3. Connect the UI to the replay engine:
     - On scrub: call `getStateAtTime()` and render the result in the terminal area.
     - On play: advance the scrub position at the selected speed, updating the terminal render.
     - On pause: stop advancement.
     - On timeline marker click: jump to that event's timestamp.
  4. Render terminal state using a terminal emulator component (reuse or adapt the existing ghostty/rio renderer).
  5. Handle long sessions (> 1 hour) efficiently: lazy-load events and snapshots as the scrub moves.
  6. Show loading indicator when reconstructing state at a new position.
  7. Handle sessions with no replay data: show "No replay data available" message.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/session-replay.ts`
- Acceptance:
  - Replay UI renders terminal state at any timestamp.
  - Time-scrub, play/pause, and speed controls work.
  - Timeline markers for significant events.
  - Long sessions handled without memory issues.
- Parallel: No.

### Subtask T017 - Implement retention policy model

- Purpose: Define per-workspace retention policies that control how long audit events are kept.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/retention.ts`.
  2. Define `RetentionPolicy` interface:
     - `workspaceId`: string
     - `ttlDays`: number (default 30)
     - `legalHold`: boolean (default false; if true, override TTL — events are never purged)
     - `purgeSchedule`: cron expression or interval string (default: daily)
  3. Implement `RetentionPolicyStore`:
     - Load/save policies from SQLite (separate table `retention_policies`).
     - `getPolicy(workspaceId)`: return policy or default.
     - `setPolicy(workspaceId, policy)`: create or update.
  4. Define `DeletionProof` interface:
     - `proofId`: unique string
     - `workspaceId`: string
     - `purgedEventCount`: number
     - `oldestEventTimestamp`, `newestEventTimestamp`: ISO 8601
     - `hashChain`: string (hash of all purged event IDs in order)
     - `purgedAt`: ISO 8601
  5. The hash chain provides verifiable proof that specific events were purged (not selectively deleted).
  6. Export types for use by the purge engine and UI.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/retention.ts`
- Acceptance:
  - Retention policies configurable per workspace.
  - Legal hold overrides TTL.
  - Deletion proof schema defined.
  - Default 30-day TTL.
- Parallel: No.

### Subtask T018 - Implement automated retention purge with deletion proofs

- Purpose: Automatically purge expired events while producing verifiable deletion proofs.
- Steps:
  1. In `retention.ts` or a new `purge.ts`, implement `RetentionPurger` class:
     - `runPurge(workspaceId?)`: for each workspace, check the retention policy, find events older than TTL.
     - Skip workspaces with `legalHold: true`.
     - For expired events:
       a. Compute the hash chain: hash each event ID in order, chain the hashes.
       b. Record event metadata (count, time range) for the deletion proof.
       c. Delete the events from SQLite.
       d. Delete associated snapshots.
       e. Create and persist the `DeletionProof`.
     - Write an audit event documenting the purge itself (meta-audit).
  2. Run purge on a configurable schedule (timer-based, default daily).
  3. Ensure purge is atomic per workspace: either all expired events are purged or none (transaction).
  4. Handle partial failures: if deletion fails, do not create a deletion proof.
  5. Add a `bun run audit:purge` command for manual purge triggering.
  6. Test: create events older than TTL, run purge, verify deletion and valid proof.
  7. Test: create events with legal hold, run purge, verify events preserved.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/retention.ts` (or new purge.ts)
- Acceptance:
  - Expired events purged with valid deletion proofs.
  - Legal hold events preserved.
  - Purge is atomic per workspace.
  - Meta-audit event records the purge.
- Parallel: No.

### Subtask T019 - Implement JSON export with redaction hooks

- Purpose: Produce exportable audit bundles with sensitive values redacted per spec 028 rules.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/export.ts`.
  2. Implement `AuditExporter` class:
     - `exportWorkspace(workspaceId, filter?): ExportBundle`: query events matching the filter, apply redaction, produce JSON bundle.
     - `exportSession(sessionId): ExportBundle`: export all events and snapshots for a session.
  3. Define `ExportBundle` interface: `{ metadata: ExportMetadata, events: AuditEvent[], snapshots?: SessionSnapshot[] }`.
  4. Implement redaction hooks:
     - Define `RedactionRule` interface: `{ pattern: RegExp, replacement: string, description: string }`.
     - Apply redaction rules to all string fields in events and snapshots before export.
     - If no redaction rules are configured (spec 028 not yet implemented), block the export with a clear error: "Redaction rules required before export is permitted."
  5. Add placeholder redaction rules for common sensitive patterns: API keys, passwords, tokens, email addresses.
  6. Validate export completeness: every event in the query result must appear in the bundle.
  7. Add export metadata: workspace ID, export timestamp, event count, redaction rules applied.
  8. Add `bun run audit:export` command.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/export.ts`
- Acceptance:
  - Export produces valid JSON bundles.
  - Redaction hooks applied to all string fields.
  - Export blocked without redaction rules.
  - Export metadata complete.
- Parallel: No.

### Subtask T020 - Chaos, retention, and export tests

- Purpose: Validate the complete audit system under stress with chaos scenarios, retention compliance, and export redaction.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/compliance.test.ts`.
  2. Chaos test: write events for 1 hour (simulated), simulate crashes at random intervals, verify zero event loss by comparing written vs persisted counts.
  3. Retention test: create events with known timestamps, configure 7-day TTL, advance time simulation, run purge, verify only expired events deleted.
  4. Retention test: create events, set legal hold, run purge, verify events preserved despite TTL expiry.
  5. Retention test: verify deletion proofs are valid (recompute hash chain from purged event IDs and compare).
  6. Export test: create 1000 events with simulated sensitive data, export with redaction, verify zero sensitive values in output (scan for known patterns).
  7. Export test: attempt export without redaction rules, verify export is blocked.
  8. Export test: verify export bundle contains all queried events (completeness check).
  9. Soak test: write 100k events over simulated 24 hours, verify audit completeness (every event has a corresponding record).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/compliance.test.ts`
- Acceptance:
  - Zero event loss in chaos scenarios.
  - Retention purge correct (expired only, legal hold respected).
  - Deletion proofs valid.
  - Export redaction verified across 1000 bundles.
- Parallel: Yes (after T014-T019 are functional).

### Subtask T021 - Replay fidelity tests

- Purpose: Validate that session replay accurately reconstructs terminal output.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/replay-fidelity.test.ts`.
  2. Record a test session: execute a series of known commands with known output, capturing snapshots at 30-second intervals.
  3. Replay the session and compare the reconstructed terminal buffer at specific timestamps against the known expected output.
  4. Test time-scrub: scrub to 5 specific timestamps, verify the terminal state matches within 200ms render time.
  5. Test missing snapshots: delete intermediate snapshots, replay, verify the engine degrades to event-only reconstruction with reduced fidelity.
  6. Test corrupted snapshot: modify a snapshot's terminal buffer, replay, verify the engine falls back to the previous valid snapshot.
  7. Test long session (1 hour simulated): verify replay does not run out of memory.
  8. Test playback controls: verify play, pause, and speed changes work without skipping or repeating events.
  9. Measure scrub-to-render latency for various session lengths and assert < 200ms (p95).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/audit/replay-fidelity.test.ts`
- Acceptance:
  - 95%+ visual accuracy for test sessions.
  - Scrub-to-render < 200ms (p95).
  - Missing/corrupted snapshots handled gracefully.
  - Long sessions handled without memory issues.
- Parallel: Yes (after T014-T016 are functional).

## Test Strategy

- Chaos tests for zero event loss.
- Retention compliance with known-timestamp events.
- Deletion proof hash chain verification.
- Export redaction scanning (1000 bundles).
- Replay visual diff against known output.
- Performance benchmarks for scrub-to-render.

## Risks & Mitigations

- Risk: Replay fidelity depends on snapshot interval.
- Mitigation: Event-based interpolation between snapshots; document fidelity limitations.
- Risk: Deletion proof hash chain computation is slow for large purge batches.
- Mitigation: Batch hash computation; stream-based hashing.

## Review Guidance

- Confirm snapshots captured at configurable intervals.
- Confirm replay handles missing/corrupted snapshots gracefully.
- Confirm retention purge respects legal hold.
- Confirm deletion proofs are verifiable.
- Confirm export blocks without redaction rules.
- Confirm chaos tests use real storage (not mocked).

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:36:09Z – claude-haiku – shell_pid=82027 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:37:26Z – claude-haiku – shell_pid=82027 – lane=done – Implemented: Session snapshots, replay engine, retention policies, deletion proofs, and secure export with redaction
