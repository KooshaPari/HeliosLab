---
work_package_id: WP01
title: Crash Detection and Watchdog
lane: "done"
dependencies: []
base_branch: main
base_commit: 8cf5e72ef31fd586a01db0480786816a9013e2c7
created_at: '2026-03-01T13:30:09.400341+00:00'
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 0 - Detection
assignee: ''
agent: "claude-haiku"
shell_pid: "57374"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Crash Detection and Watchdog

## Objectives & Success Criteria

- Implement a watchdog heartbeat monitor that detects abnormal termination of the runtime daemon, ElectroBun host, and renderer worker processes.
- Implement exit code monitoring to classify crash vs. graceful shutdown.
- Detect crash loops (3+ crashes within 60 seconds) and enter safe mode with minimal subsystems.
- Ensure the watchdog itself is resilient and minimal to reduce its own crash surface.

Success criteria:
- Watchdog detects runtime daemon crash within 2 heartbeat intervals.
- Exit code monitoring classifies SIGKILL, SIGTERM, and non-zero exits correctly.
- Crash loop detection triggers safe mode within 5 seconds of the third crash (SC-027-004).
- Safe mode disables non-essential subsystems and presents minimal UI.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/027-crash-recovery-and-restoration/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/027-crash-recovery-and-restoration/spec.md`
- Protocol bus:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`

Constraints:
- TypeScript + Bun runtime.
- Watchdog must be minimal (under 200 lines) to minimize its own crash surface.
- Heartbeat interval configurable (default 2000ms).
- No external dependencies beyond Bun builtins.
- Recovery SLOs: crash-to-live < 10s for 25 terminals.
- Coverage >=85% with FR-027-001, FR-027-009 traceability.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement watchdog heartbeat monitor

- Purpose: Detect abnormal termination of critical processes via heartbeat timeout.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/watchdog.ts`.
  2. Implement `Watchdog` class:
     - `registerProcess(name: string, pid: number, heartbeatIntervalMs: number): void` -- register a process to monitor.
     - `receiveHeartbeat(name: string): void` -- reset timeout for the named process.
     - `unregister(name: string): void` -- stop monitoring.
     - `onCrashDetected(callback: (name: string, pid: number, reason: CrashReason) => void): void` -- register crash handler.
  3. Implement heartbeat timeout logic:
     - For each registered process, maintain a timer that fires at `2 * heartbeatIntervalMs` (2 missed heartbeats = crash).
     - On timeout: check if process is still running (kill -0 or Bun process check).
     - If process is gone: invoke crash handler with `CrashReason.HEARTBEAT_TIMEOUT`.
     - If process is alive but not sending heartbeats: invoke crash handler with `CrashReason.UNRESPONSIVE`.
  4. Define `CrashReason` enum: `HEARTBEAT_TIMEOUT`, `UNRESPONSIVE`, `EXIT_CODE`, `SIGNAL`.
  5. Implement heartbeat sender utility for monitored processes:
     - `startHeartbeat(watchdogIpcChannel: IpcChannel, intervalMs: number): () => void` -- returns stop function.
     - Sends periodic heartbeat messages via IPC.
  6. Ensure watchdog timer cleanup on unregister (no stale timers).
  7. Keep watchdog code minimal (target < 150 lines for core logic).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/watchdog.ts`
- Validation:
  - Heartbeat timeout fires within 2x interval of last heartbeat.
  - Process-gone detection works (kill -0 check).
  - Unresponsive detection works (process alive but no heartbeat).
  - Unregister clears timers.
  - Code is under 200 lines.
- Parallel: No.

### Subtask T002 - Implement exit code monitoring and abnormal termination detection

- Purpose: Classify process exits as crash vs. graceful shutdown for recovery decision-making.
- Steps:
  1. In `watchdog.ts`, add exit monitoring for registered processes:
     - Use `Bun.spawn` process exit event or PID monitoring to detect exits.
     - Capture exit code and signal.
  2. Implement classification logic:
     - Exit code 0: graceful shutdown, no recovery needed.
     - Exit code != 0 (no signal): crash, `CrashReason.EXIT_CODE`.
     - SIGTERM: graceful termination (user-initiated or system shutdown), no recovery unless unexpected.
     - SIGKILL: forced kill, `CrashReason.SIGNAL`, recovery needed.
     - SIGSEGV, SIGBUS, SIGABRT: crash, `CrashReason.SIGNAL`, recovery needed.
  3. Publish crash detection event on bus (if bus is available):
     - Topic: `recovery.crash.detected`
     - Payload: process name, PID, exit code, signal, crash reason, timestamp.
  4. Write crash record to filesystem (for post-crash recovery):
     - File: `<data-dir>/recovery/last-crash.json`.
     - Content: process name, PID, exit code, signal, timestamp.
     - Use atomic write (write temp + rename) to prevent corruption.
  5. Handle case where bus is unavailable (runtime daemon crashed):
     - Fall back to filesystem crash record only.
     - Recovery process reads crash record on next launch.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/watchdog.ts`
- Validation:
  - Exit code 0 is classified as graceful.
  - SIGKILL, SIGSEGV are classified as crash.
  - Crash record written atomically to filesystem.
  - Bus event published when bus is available.
  - Filesystem fallback works when bus is unavailable.
- Parallel: No.

### Subtask T003 - Implement crash loop detection and safe mode entry

- Purpose: Prevent runaway crash-restart cycles by entering safe mode.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/safe-mode.ts`.
  2. Implement `CrashLoopDetector` class:
     - `recordCrash(timestamp: number): void` -- record a crash occurrence.
     - `isLooping(): boolean` -- return true if 3+ crashes within 60s window.
     - Maintain a sliding window of crash timestamps.
     - Window size and threshold configurable (default: 3 crashes, 60s window).
  3. Persist crash history to filesystem:
     - File: `<data-dir>/recovery/crash-history.json`.
     - Read on startup to detect loops across restarts.
     - Atomic writes.
  4. Implement `SafeMode` class:
     - `enter(): void` -- disable non-essential subsystems:
       - Disable provider adapters (spec 025).
       - Disable share sessions (spec 026).
       - Disable background checkpoint writes.
       - Keep: watchdog, bus (minimal), recovery state machine, UI (minimal banner).
     - `isActive(): boolean` -- check if safe mode is active.
     - `exit(): void` -- re-enable subsystems (operator-initiated).
     - Publish `recovery.safemode.entered` and `recovery.safemode.exited` bus events.
  5. Integrate with watchdog:
     - On crash detected, call `CrashLoopDetector.recordCrash()`.
     - If `isLooping()`, call `SafeMode.enter()`.
  6. Safe mode UI: show a banner indicating safe mode with instructions to exit or report issue.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/safe-mode.ts`
- Validation:
  - 3 crashes in 60s triggers safe mode.
  - 2 crashes in 60s does not trigger safe mode.
  - 3 crashes over > 60s does not trigger safe mode.
  - Safe mode disables correct subsystems.
  - Safe mode exit re-enables subsystems.
  - Crash history persists across restarts.
  - Bus events emitted for enter/exit.
- Parallel: No.

### Subtask T004 - Add unit tests for watchdog, exit code monitoring, crash loop, and safe mode

- Purpose: Lock crash detection behavior before recovery state machine is built.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/__tests__/`.
  2. Add `watchdog.test.ts`:
     - Test heartbeat timeout detection (use fake timers).
     - Test process-gone detection with mock PID check.
     - Test unresponsive detection (process alive, no heartbeat).
     - Test unregister clears timers.
     - Test crash handler invocation with correct CrashReason.
  3. Add `exit-code.test.ts`:
     - Test exit code 0 -> graceful.
     - Test exit code != 0 -> crash.
     - Test SIGKILL -> crash.
     - Test SIGSEGV -> crash.
     - Test SIGTERM -> graceful termination.
     - Test crash record written atomically.
     - Test bus event published when bus available.
     - Test filesystem fallback when bus unavailable.
  4. Add `safe-mode.test.ts`:
     - Test crash loop detection threshold (3 in 60s).
     - Test below threshold (2 in 60s) -> no safe mode.
     - Test outside window (3 in > 60s) -> no safe mode.
     - Test safe mode enter disables subsystems.
     - Test safe mode exit re-enables subsystems.
     - Test crash history persistence across restarts.
     - Test bus events for safe mode enter/exit.
  5. Map tests to requirements:
     - FR-027-001 (crash detection): watchdog and exit code tests.
     - FR-027-009 (crash loop): safe mode tests.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/__tests__/watchdog.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/__tests__/exit-code.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/recovery/__tests__/safe-mode.test.ts`
- Validation:
  - All tests pass.
  - Coverage >=85% on watchdog.ts and safe-mode.ts.
  - FR-027-001 and FR-027-009 each have at least one mapped test.
- Parallel: Yes (after T001-T003 are stable).

## Test Strategy

- Use Vitest fake timers for heartbeat and crash loop timing tests.
- Mock PID checks for process-gone detection.
- Use temporary filesystem directories for crash record persistence tests.
- Bus events captured via test spy.

## Risks & Mitigations

- Risk: Watchdog timer overhead affects runtime performance.
- Mitigation: Heartbeat interval is >= 2s; timer count is bounded by registered process count (typically 3-5).
- Risk: Crash history file corruption prevents loop detection.
- Mitigation: Atomic writes + validation on read; corrupt file treated as empty history.

## Review Guidance

- Confirm watchdog is minimal (< 200 lines core logic).
- Confirm exit code classification covers all expected signals.
- Confirm crash record uses atomic write strategy.
- Confirm safe mode disables correct subsystems and is operator-exitable.
- Confirm crash loop threshold is configurable.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:30:10Z – claude-haiku – shell_pid=57374 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:31:39Z – claude-haiku – shell_pid=57374 – lane=done – Implemented
