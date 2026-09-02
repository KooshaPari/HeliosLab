---
work_package_id: WP01
title: Upterm Adapter and Tmate Adapter
lane: "doing"
dependencies: []
base_branch: main
base_commit: 9193a7f87efc98959258649efff53c5f953704d8
created_at: '2026-03-01T13:37:06.801825+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 0 - Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "89230"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Upterm Adapter and Tmate Adapter

## Objectives & Success Criteria

- Implement the share session entity with on-demand worker lifecycle management.
- Deliver upterm and tmate share backend adapters with link generation and backend selection at share time.
- Integrate policy gate (spec 023) as deny-by-default pre-share hook that blocks worker start on denial.
- Ensure share workers are on-demand processes that do not run as background daemons.

Success criteria:
- Upterm adapter generates a share link within 3 seconds after policy approval.
- Tmate adapter generates a share link within 3 seconds after policy approval.
- Switching backends terminates the previous share worker and starts a new one.
- Policy denial prevents share worker start and returns clear denial reason.
- Share worker crash does not affect the host terminal PTY.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/026-share-session-workflows/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/026-share-session-workflows/spec.md`
- Protocol bus:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
- Zellij session integration (spec 009):
  - Share targets are zellij-managed terminal sessions.

Constraints:
- TypeScript + Bun runtime.
- On-demand workers only; no background daemons per terminal.
- Share link generation < 3s (p95) after policy approval.
- Worker memory < 15 MB per active share.
- Worker crash must not affect host terminal PTY (NFR-026-004).
- Coverage >=85% with FR-026-* traceability.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement share session entity and on-demand worker lifecycle

- Purpose: Define the share session data model and manage worker process lifecycle.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/share-session.ts`.
  2. Define `ShareSession` type with fields:
     - `id: string` -- unique share session identifier.
     - `terminalId: string` -- the terminal being shared.
     - `backend: 'upterm' | 'tmate'` -- selected share backend.
     - `shareLink: string | null` -- generated share link (null until ready).
     - `state: 'pending' | 'active' | 'expired' | 'revoked' | 'failed'` -- lifecycle state.
     - `ttlMs: number` -- time-to-live in milliseconds.
     - `createdAt: Date`, `expiresAt: Date | null`.
     - `workerPid: number | null` -- PID of the share worker process.
     - `correlationId: string` -- link to originating request.
  3. Define `ShareSessionManager` class:
     - `create(terminalId: string, backend: string, ttlMs: number, correlationId: string): Promise<ShareSession>` -- validate inputs, check policy gate, spawn worker, generate link.
     - `terminate(sessionId: string): Promise<void>` -- kill worker, clean up, transition state.
     - `get(sessionId: string): ShareSession | undefined`.
     - `listByTerminal(terminalId: string): ShareSession[]`.
     - Track all active sessions in memory.
  4. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/share-worker.ts`.
  5. Implement `ShareWorker` class:
     - `spawn(backend: string, terminalId: string, config: ShareWorkerConfig): Promise<{ pid: number, link: string }>`.
     - Spawns a child process running the selected backend binary (upterm or tmate).
     - Captures the generated share link from worker stdout.
     - Implements heartbeat monitoring: worker sends periodic heartbeat via IPC; timeout triggers cleanup.
     - `kill(): Promise<void>` -- send SIGTERM, wait up to 3s, then SIGKILL if needed.
     - Resource cleanup: close IPC channels, verify PID no longer running.
  6. Emit lifecycle events on bus:
     - `share.session.created`, `share.session.active`, `share.session.terminated`, `share.session.failed`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/share-session.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/share-worker.ts`
- Validation:
  - Share session creation spawns worker and captures link.
  - Worker heartbeat timeout triggers cleanup.
  - Terminate kills worker and transitions state.
  - Bus events emitted for all lifecycle transitions.
  - No orphan processes after terminate.
- Parallel: No.

### Subtask T002 - Implement upterm share backend adapter

- Purpose: Deliver the upterm-specific share backend for terminal sharing.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/upterm-adapter.ts`.
  2. Implement `UptermAdapter` class:
     - `checkAvailability(): Promise<boolean>` -- verify `upterm` binary exists on PATH.
     - `startShare(terminalId: string, zelijjSessionName: string): Promise<{ link: string, process: ChildProcess }>`:
       - Construct upterm command: `upterm host --server <configured-server> -- <attach-to-zellij-session>`.
       - Spawn the command as a child process.
       - Parse stdout for the share link (upterm outputs the link on startup).
       - Set up heartbeat monitoring via process exit event.
       - Return link and process handle.
     - `stopShare(process: ChildProcess): Promise<void>`:
       - Send SIGTERM, wait, SIGKILL if needed.
       - Verify process exited.
  3. Define `UptermConfig` type: `server: string` (default upterm.io or custom), `forceCommand?: string`.
  4. Handle upterm-specific error scenarios:
     - Binary not found: clear error with installation instructions.
     - Server unreachable: retryable error.
     - Auth failure: non-retryable error with credential guidance.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/upterm-adapter.ts`
- Validation:
  - Adapter checks binary availability before attempting share.
  - Share link is captured from upterm stdout.
  - Error scenarios produce clear, actionable error messages.
  - Process cleanup is complete on stop.
- Parallel: No.

### Subtask T003 - Implement tmate share backend adapter

- Purpose: Deliver the tmate-specific share backend as an alternative to upterm.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/tmate-adapter.ts`.
  2. Implement `TmateAdapter` class:
     - `checkAvailability(): Promise<boolean>` -- verify `tmate` binary exists on PATH.
     - `startShare(terminalId: string, zelijjSessionName: string): Promise<{ link: string, process: ChildProcess }>`:
       - Construct tmate command: `tmate -F` (foreground mode for link capture).
       - Spawn as child process.
       - Parse stdout for the SSH share link (tmate outputs `ssh <link>` and `web: <url>`).
       - Capture both SSH and web links; prefer web link for share URL.
       - Set up heartbeat via process exit event.
     - `stopShare(process: ChildProcess): Promise<void>`:
       - Send SIGTERM, wait, SIGKILL if needed.
  3. Define `TmateConfig` type: `socketPath?: string`, `preferWebLink: boolean` (default true).
  4. Handle tmate-specific error scenarios:
     - Binary not found: clear error with installation instructions.
     - Socket creation failure: retryable error.
     - Link capture timeout (link not output within 10s): timeout error.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/tmate-adapter.ts`
- Validation:
  - Adapter checks binary availability.
  - Share link captured from tmate output.
  - Both SSH and web links are parsed; web preferred.
  - Error scenarios produce actionable messages.
- Parallel: No.

### Subtask T004 - Integrate policy gate as deny-by-default pre-share hook

- Purpose: Block unauthorized share sessions before any worker process is started.
- Steps:
  1. In `share-session.ts` `ShareSessionManager.create()`, before spawning worker:
     - Call policy gate: `policyGate.evaluate('share.session.create', { terminalId, backend, correlationId })`.
     - If denied: throw normalized error with denial reason, publish `share.policy.denied` bus event, do not spawn worker.
     - If approved: proceed with worker spawn.
  2. Define or import `PolicyGate` interface (same as spec 023 / provider adapter pattern):
     - `evaluate(action: string, context: PolicyContext): Promise<PolicyDecision>`.
     - Default: deny-by-default stub (returns denied unless explicitly configured to allow).
  3. Make policy gate injectable via constructor for testability.
  4. Log policy evaluation result in audit trail (via bus event).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/share-session.ts`
- Validation:
  - Default policy denies all shares (deny-by-default).
  - Denial prevents worker spawn and returns clear reason.
  - Bus event emitted on denial.
  - Approved requests proceed to worker spawn.
- Parallel: No.

### Subtask T005 - Add unit tests for share session lifecycle, adapters, and policy gate

- Purpose: Lock share session contracts and adapter behavior before TTL and handoff features.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/__tests__/`.
  2. Add `share-session.test.ts`:
     - Test session creation with approved policy -> worker spawned, link returned.
     - Test session creation with denied policy -> error, no worker spawned.
     - Test session termination -> worker killed, state transitioned.
     - Test listByTerminal filtering.
     - Test bus event emission for all lifecycle transitions.
     - Test worker heartbeat timeout triggers cleanup.
  3. Add `upterm-adapter.test.ts`:
     - Test binary availability check (mock binary presence/absence).
     - Test link capture from mock upterm stdout.
     - Test error scenarios (binary missing, server unreachable).
     - Test process cleanup on stop.
  4. Add `tmate-adapter.test.ts`:
     - Test binary availability check.
     - Test SSH and web link capture from mock tmate stdout.
     - Test web link preference.
     - Test error scenarios (binary missing, link capture timeout).
  5. Add `policy-gate.test.ts`:
     - Test deny-by-default behavior.
     - Test allow-when-configured behavior.
     - Test bus event on denial.
  6. Map tests to requirements:
     - FR-026-001 (upterm/tmate backends): adapter tests.
     - FR-026-002 (policy gate): policy tests.
     - FR-026-009 (on-demand workers): worker lifecycle tests.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/__tests__/share-session.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/__tests__/upterm-adapter.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/__tests__/tmate-adapter.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/sharing/__tests__/policy-gate.test.ts`
- Validation:
  - All tests pass.
  - Coverage >=85% on share-session.ts, share-worker.ts, upterm-adapter.ts, tmate-adapter.ts.
  - Each mapped FR has at least one test.
- Parallel: Yes (after T001-T004 are stable).

## Test Strategy

- Mock upterm/tmate binaries via mock child processes with configurable stdout output.
- Policy gate injected as mock for approval/denial scenarios.
- Bus events captured via test spy.
- Worker process tests use real child processes with mock logic.

## Risks & Mitigations

- Risk: upterm/tmate output format changes break link capture.
- Mitigation: Link parsing uses regex with version-specific patterns; test with pinned output samples.
- Risk: Worker heartbeat timing causes flaky tests.
- Mitigation: Use short heartbeat intervals in tests with deterministic timeouts.

## Review Guidance

- Confirm on-demand worker lifecycle has no background daemon behavior.
- Confirm policy gate is deny-by-default with explicit approval required.
- Confirm both adapters check binary availability before share attempt.
- Confirm worker crash does not affect host terminal PTY.
- Confirm bus events emitted for all lifecycle transitions.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:37:07Z – claude-haiku – shell_pid=89230 – lane=doing – Assigned agent via workflow command
