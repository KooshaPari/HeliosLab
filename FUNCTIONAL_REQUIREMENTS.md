# Functional Requirements

## Overview

This document specifies all functional requirements for heliosApp extracted from the 30 technical specifications in the `kitty-specs/` directory. Requirements are organized by domain and category, with each requirement identified by a unique FR ID in the format `FR-{CAT}-{NNN}` where CAT is a three-letter category code and NNN is a three-digit sequence number.

## Categories by Domain

### Application

- **MVP**: Helios MVP Agent IDE (spec 030) (27 requirements)

### Build

- **DEP**: Prerelease Dependency Registry (spec 020) (8 requirements)
- **RUN**: TS7 and Bun Runtime Setup (spec 019) (8 requirements)

### CI/CD

- **CI**: Continuous Integration and Quality Gates (spec 021) (11 requirements)
- **REV**: Code Review and Governance Process (spec 022) (10 requirements)

### Collaboration

- **SHR**: Share Session Workflows (spec 026) (11 requirements)

### Configuration

- **CFG**: App Settings and Feature Flags (spec 004) (10 requirements)
- **ENG**: Renderer Engine Settings Control (spec 018) (8 requirements)

### Core

- **BND**: Terminal-to-Lane-Session Binding (spec 014) (8 requirements)
- **LAN**: PAR Lane Orchestrator Integration (spec 008) (8 requirements)
- **PTY**: PTY Lifecycle Manager (spec 007) (8 requirements)
- **ZMX**: Zellij Mux Session Adapter (spec 009) (8 requirements)

### Extension

- **PVD**: Provider Adapter Interface and Lifecycle (spec 025) (12 requirements)

### Infrastructure

- **BUS**: Local Bus V1 Protocol and Envelope (spec 002) (10 requirements)
- **ID**: ID Standards and Cross-Repo Coordination (spec 005) (9 requirements)

### Observability

- **AUD**: Audit Logging and Session Replay (spec 024) (11 requirements)
- **PRF**: Performance Baseline and Instrumentation (spec 006) (10 requirements)

### Rendering

- **GHT**: Ghostty Renderer Backend (spec 011) (7 requirements)
- **RIO**: Rio Renderer Backend (spec 012) (8 requirements)
- **RND**: Renderer Adapter Interface (spec 010) (8 requirements)
- **TXN**: Renderer Switch Transaction (spec 013) (8 requirements)

### Resilience

- **CRH**: Crash Recovery and Restoration (spec 027) (10 requirements)
- **ORF**: Lane Orphan Detection and Remediation (spec 015) (9 requirements)

### Security

- **APR**: Command Policy Engine and Approval Workflows (spec 023) (11 requirements)
- **SEC**: Secrets Management and Redaction (spec 028) (11 requirements)

### Shell

- **SHL**: Terminal-First Desktop Shell (spec 001) (10 requirements)

### Storage

- **PER**: Workspace and Project Metadata Persistence (spec 003) (10 requirements)

### UI

- **LST**: Lane List and Status Display (spec 017) (7 requirements)
- **TAB**: Workspace Lane Session UI Tabs (spec 016) (7 requirements)

---

## APPLICATION

### MVP - Helios MVP Agent IDE (spec 030)

- **FR-MVP-001**: SHALL System MUST provide a persistent chat interface where users can send natural language prompts
- **FR-MVP-002**: SHALL System MUST stream agent responses in real time with visible token-by-token rendering
- **FR-MVP-003**: SHALL System MUST display the agent's tool calls (file reads, writes, terminal commands) inline in the chat
- **FR-MVP-004**: SHALL System MUST support multi-turn conversations with full context retention
- **FR-MVP-005**: SHALL System MUST allow users to interrupt or cancel an in-progress agent action
- **FR-MVP-006**: SHALL System MUST spawn real PTY shell sessions using the user's default shell
- **FR-MVP-007**: SHALL System MUST render terminal output with full ANSI color and cursor support
- **FR-MVP-008**: SHALL System MUST support multiple concurrent terminal instances
- **FR-MVP-009**: SHALL System MUST allow the agent to execute commands in any open terminal
- **FR-MVP-010**: SHALL System MUST support terminal resize events
- **FR-MVP-011**: SHALL System MUST persist all conversations across app restarts
- **FR-MVP-012**: SHALL System MUST persist user settings (preferred model, theme, keybindings)
- **FR-MVP-013**: SHALL System MUST persist lane and session state for recovery
- **FR-MVP-014**: SHALL System MUST support at least one cloud inference provider (Anthropic API)
- **FR-MVP-015**: SHALL System MUST support local inference on Apple Silicon hardware
- **FR-MVP-016**: SHALL System MUST support local/server inference on NVIDIA GPU hardware
- **FR-MVP-017**: SHALL System MUST auto-detect available hardware capabilities at startup
- **FR-MVP-018**: SHALL System MUST allow users to switch inference providers without losing conversation state
- **FR-MVP-019**: SHALL System MUST fall back gracefully when a selected provider becomes unavailable
- **FR-MVP-020**: SHALL System MUST support creating isolated workspace lanes with independent state
- **FR-MVP-021**: SHALL System MUST support terminal session sharing via external tools
- **FR-MVP-022**: SHALL Muxer dispatch MUST delegate to real adapter implementations (not in-memory tracking only)
- **FR-MVP-023**: SHALL System MUST provide a left sidebar for conversation history and navigation
- **FR-MVP-024**: SHALL System MUST provide a center panel for the active chat conversation
- **FR-MVP-025**: SHALL System MUST provide a bottom input area with model selector and send controls
- **FR-MVP-026**: SHALL System MUST provide integrated terminal panels (bottom or side)
- **FR-MVP-027**: SHALL System MUST support keyboard shortcuts for common actions (new chat, toggle terminal, switch tabs)

## BUILD

### DEP - Prerelease Dependency Registry (spec 020)

- **FR-DEP-001**: SHALL maintain a registry manifest listing each tracked prerelease dependency with its name, current pin, channel (alpha/beta/RC/stable), upstream source, and known-good version history.
- **FR-DEP-002**: SHALL A `bun run deps:status` command MUST report the current state of all tracked dependencies including available upgrades.
- **FR-DEP-003**: SHALL provide deterministic lockfile pins per workspace package so that each package can be upgraded and rolled back independently.
- **FR-DEP-004**: SHALL A `bun run deps:rollback <package>` command MUST revert a named dependency to its last known-good pin and regenerate the lockfile.
- **FR-DEP-005**: SHALL The rollback operation MUST be atomic: either the full reversion succeeds or no lockfile changes are persisted.
- **FR-DEP-006**: SHALL The canary process MUST create an isolated branch, apply the upgrade, run all quality gates from spec 021, and report results.
- **FR-DEP-007**: SHALL The canary process MUST auto-merge passing upgrades and open an issue for failing upgrades.
- **FR-DEP-008**: SHALL Every upgrade attempt (success or failure) MUST be recorded in a structured dependency changelog with timestamp, versions, gate results, and actor.

### RUN - TS7 and Bun Runtime Setup (spec 019)

- **FR-RUN-001**: SHALL The repository MUST use Bun workspaces with at least two packages: `apps/desktop` (ElectroBun shell) and `apps/runtime` (core runtime logic).
- **FR-RUN-002**: SHALL The root `package.json` MUST declare workspace paths, the minimum Bun version, and the TypeScript 7 dependency.
- **FR-RUN-003**: SHALL The build system MUST produce a runnable ElectroBun desktop application from `apps/desktop`.
- **FR-RUN-004**: SHALL A `bun dev` script MUST start a development server with hot-reload support for all workspace packages.
- **FR-RUN-005**: SHALL A `bun run typecheck` script MUST execute TypeScript strict-mode type checking across all workspace packages and exit non-zero on any error.
- **FR-RUN-006**: SHALL A `bun run build` script MUST produce a production-optimized bundle for the desktop shell.
- **FR-RUN-007**: SHALL Each workspace package MUST have its own `tsconfig.json` extending a shared root `tsconfig.base.json` with strict mode, no implicit any, and strict null checks enabled.
- **FR-RUN-008**: SHALL Path aliases defined in `tsconfig` MUST resolve correctly for both the build toolchain and the runtime.

## CI/CD

### CI - Continuous Integration and Quality Gates (spec 021)

- **FR-CI-001**: SHALL The CI pipeline MUST execute the following gates in order: (1) TypeScript strict type check, (2) lint/format via Biome, (3) Vitest unit tests, (4) Playwright e2e tests, (5) coverage threshold check, (6) security scan, (7) static analysis, (8) gate-bypass detection.
- **FR-CI-002**: SHALL The type check gate MUST run TypeScript in strict mode with no implicit any, strict null checks, and all flags matching the project `tsconfig.base.json`.
- **FR-CI-003**: SHALL The lint gate MUST use Biome at maximum strictness with ESLint as a secondary cross-check where Biome rules do not yet cover the required surface.
- **FR-CI-004**: SHALL The unit test gate MUST run all Vitest test suites and fail on any test failure, including tests marked with `.skip`, `.only`, or `.todo` (these markers are themselves failures).
- **FR-CI-005**: SHALL The e2e test gate MUST run all Playwright test suites against a built desktop artifact.
- **FR-CI-006**: SHALL The coverage gate MUST enforce a minimum of 85% line coverage across the monorepo aggregate and per workspace package.
- **FR-CI-007**: SHALL The security scan gate MUST check for known vulnerabilities in dependencies and flag high/critical severity findings as failures.
- **FR-CI-008**: SHALL The static analysis gate MUST detect anti-patterns, complexity violations, and dead code.
- **FR-CI-009**: SHALL The gate-bypass detection step MUST scan all source files for suppression directives (lint-ignore, eslint-disable, @ts-ignore, @ts-expect-error without matching error, .skip, .only) and fail if any are found.
- **FR-CI-010**: SHALL A `bun run gates` command MUST execute the identical gate suite locally with the same configuration and thresholds as CI.
- **FR-CI-011**: SHALL Every gate failure MUST produce a structured report with gate name, file path, line number (where applicable), error detail, and remediation hint.

### REV - Code Review and Governance Process (spec 022)

- **FR-REV-001**: SHALL Every PR MUST be blocked from merge until at least one agent reviewer has approved it.
- **FR-REV-002**: SHALL GCA and CodeRabbit automated reviews MUST be configured as required status checks that block merge on failure or absence.
- **FR-REV-003**: SHALL If an automated review tool is rate-limited or unavailable, the system MUST block merge and automatically request re-review when the tool recovers.
- **FR-REV-004**: SHALL Self-merge MUST be permitted only when all CI quality gates (spec 021) pass AND all required reviews are approved.
- **FR-REV-005**: SHALL A constitution compliance checker MUST validate each PR against the full code review checklist defined in the constitution: correctness, tests, docs, types, error handling, performance, security, anti-patterns, library preference, backward-compat avoidance, and regression risk.
- **FR-REV-006**: SHALL The compliance checker MUST reference the specific constitution section for each finding.
- **FR-REV-007**: SHALL Constitution exceptions MUST require a linked ADR with a sunset date (or explicit permanence justification) and 3 approvals before the exception is accepted.
- **FR-REV-008**: SHALL Every merge MUST be recorded in a governance log with: PR number, author, reviewers, gate results, compliance attestation, exception ADRs (if any), and timestamp.
- **FR-REV-009**: SHALL The governance log MUST be version-controlled and append-only within the repository.
- **FR-REV-010**: SHALL Constitution amendments that affect review requirements MUST trigger re-evaluation of open PRs.

## COLLABORATION

### SHR - Share Session Workflows (spec 026)

- **FR-SHR-001**: SHALL support per-terminal sharing via upterm and tmate backends, selectable at share time.
- **FR-SHR-002**: SHALL enforce a deny-by-default policy gate before any share worker starts, integrating with spec 023 approval gates.
- **FR-SHR-003**: SHALL generate share links with a configurable TTL (default and per-request).
- **FR-SHR-004**: SHALL auto-terminate share sessions on TTL expiry and issue grace period warnings before expiry.
- **FR-SHR-005**: SHALL support TTL extension via explicit operator action.
- **FR-SHR-006**: SHALL enforce a configurable concurrent share limit per terminal.
- **FR-SHR-007**: SHALL provide revoke controls that disconnect participants within 5 seconds.
- **FR-SHR-008**: SHALL support human-to-AI and AI-to-human terminal handoff with context preservation.
- **FR-SHR-009**: SHALL start share workers on demand (no background daemon per terminal).
- **FR-SHR-010**: SHALL display share status badges in the lane panel for active shares.
- **FR-SHR-011**: SHALL record every share action (start, stop, extend, revoke, handoff) as an audit event with correlation IDs via spec 024.

## CONFIGURATION

### CFG - App Settings and Feature Flags (spec 004)

- **FR-CFG-001**: SHALL define a typed settings schema with default values for all settings.
- **FR-CFG-002**: SHALL validate all setting values against the schema before acceptance.
- **FR-CFG-003**: SHALL persist settings to local storage (JSON file in app data directory).
- **FR-CFG-004**: SHALL restore settings from persisted storage on app startup.
- **FR-CFG-005**: SHALL support hot-reload: settings marked `hot_reload: true` propagate to subscribers without restart.
- **FR-CFG-006**: SHALL support restart-required settings: changes are persisted but flagged with a "restart required" indicator.
- **FR-CFG-007**: SHALL emit `settings.changed` events via the bus (spec 002) when any setting is modified.
- **FR-CFG-008**: SHALL provide a feature flag subsystem that exposes flag values as typed queries.
- **FR-CFG-009**: SHALL define `renderer_engine` as a feature flag with values `ghostty` (default) and `rio`.
- **FR-CFG-010**: SHALL preserve unknown keys in the settings file to support forward compatibility.

### ENG - Renderer Engine Settings Control (spec 018)

- **FR-ENG-001**: SHALL provide a settings panel section for renderer engine selection.
- **FR-ENG-002**: SHALL display both ghostty and rio with their availability status and capability summary.
- **FR-ENG-003**: SHALL require user confirmation before triggering a renderer switch.
- **FR-ENG-004**: SHALL trigger the renderer switch transaction (spec 013) upon confirmed selection.
- **FR-ENG-005**: SHALL display real-time status indicators during switch transactions (phase, progress, outcome).
- **FR-ENG-006**: SHALL provide a hot-swap preference toggle (prefer hot-swap vs. always restart-with-restore).
- **FR-ENG-007**: SHALL persist renderer preference and hot-swap toggle across sessions.
- **FR-ENG-008**: SHALL lock renderer settings during an active switch transaction.

## CORE

### BND - Terminal-to-Lane-Session Binding (spec 014)

- **FR-BND-001**: SHALL maintain a terminal registry that maps every terminal_id to exactly one (workspace_id, lane_id, session_id) triple.
- **FR-BND-002**: SHALL reject terminal creation when the target lane or session does not exist or is in an invalid lifecycle state.
- **FR-BND-003**: SHALL validate terminal binding consistency before executing any terminal operation.
- **FR-BND-004**: SHALL update or invalidate terminal bindings when the bound lane or session changes lifecycle state (detach, cleanup, terminate).
- **FR-BND-005**: SHALL emit binding lifecycle events (bound, rebound, unbound, validation-failed) on the internal bus.
- **FR-BND-006**: SHALL support querying the registry by any component of the binding triple (workspace, lane, session, or terminal).
- **FR-BND-007**: SHALL enforce uniqueness of terminal_id within the registry.
- **FR-BND-008**: SHALL persist binding state durably so it survives runtime restarts.

### LAN - PAR Lane Orchestrator Integration (spec 008)

- **FR-LAN-001**: SHALL manage lanes through a state machine: `new` -> `provisioning` -> `ready` -> `running` -> `blocked` -> `shared` -> `cleaning` -> `closed`.
- **FR-LAN-002**: SHALL provision a git worktree for each lane, rooted in the workspace repository, during the `provisioning` phase.
- **FR-LAN-003**: SHALL bind each lane to a par task for execution isolation and lifecycle tracking.
- **FR-LAN-004**: SHALL publish lane lifecycle events (created, state-changed, shared, cleaning, closed) to the local bus.
- **FR-LAN-005**: SHALL clean up git worktrees and terminate par tasks when a lane transitions to `closed`.
- **FR-LAN-006**: SHALL gracefully terminate all PTYs owned by a lane before beginning worktree cleanup.
- **FR-LAN-007**: SHALL support marking lanes as `shared` for multi-agent concurrent access.
- **FR-LAN-008**: SHALL detect and reconcile orphaned lanes (worktrees without lane records, or lane records without worktrees) on startup.

### PTY - PTY Lifecycle Manager (spec 007)

- **FR-PTY-001**: SHALL manage PTY processes through a state machine with states: `idle`, `spawning`, `active`, `throttled`, `errored`, `stopped`.
- **FR-PTY-002**: SHALL maintain a process registry mapping each PTY to its owning lane, session, and terminal instance.
- **FR-PTY-003**: SHALL support spawn, resize, write-input, read-output, and terminate operations on PTY instances.
- **FR-PTY-004**: SHALL deliver POSIX signals (SIGTERM, SIGKILL, SIGWINCH, SIGHUP) to PTY child processes and reflect signal outcomes in state transitions.
- **FR-PTY-005**: SHALL enforce bounded output buffers with explicit backpressure when consumers fall behind.
- **FR-PTY-006**: SHALL publish PTY lifecycle events (spawned, state-changed, output, error, stopped) to the local bus.
- **FR-PTY-007**: SHALL support configurable grace periods for SIGTERM-to-SIGKILL escalation.
- **FR-PTY-008**: SHALL detect orphaned PTY processes on startup and reconcile them with the process registry.

### ZMX - Zellij Mux Session Adapter (spec 009)

- **FR-ZMX-001**: SHALL create, reattach, and terminate zellij sessions through a managed adapter interface.
- **FR-ZMX-002**: SHALL bind each mux session to exactly one lane and maintain that binding in the session registry.
- **FR-ZMX-003**: SHALL support pane create, close, and resize operations within a session, each triggering a corresponding PTY lifecycle action.
- **FR-ZMX-004**: SHALL support tab create, close, and switch operations within a session.
- **FR-ZMX-005**: SHALL relay mux-level events (session-created, pane-added, pane-closed, tab-created, tab-switched, session-terminated) to the local bus.
- **FR-ZMX-006**: SHALL support session reattach after runtime restart using zellij's native session persistence.
- **FR-ZMX-007**: SHALL enforce minimum pane dimensions and reject layout operations that violate them.
- **FR-ZMX-008**: SHALL reconcile session-to-lane bindings on startup and flag stale or orphaned sessions.

## EXTENSION

### PVD - Provider Adapter Interface and Lifecycle (spec 025)

- **FR-PVD-001**: SHALL define a typed adapter interface with init, health, execute, and terminate lifecycle methods.
- **FR-PVD-002**: SHALL support provider registration with configuration validation and credential binding.
- **FR-PVD-003**: SHALL integrate ACP for Claude/agent task execution with run and cancel lifecycle and local bus correlation.
- **FR-PVD-004**: SHALL integrate MCP for tool discovery, schema registration, sandboxed invocation, and result capture.
- **FR-PVD-005**: SHALL integrate A2A for external agent delegation with failure isolation and local bus sync.
- **FR-PVD-006**: SHALL maintain per-provider credential stores isolated from other providers.
- **FR-PVD-007**: SHALL enforce process-level isolation for provider execution contexts.
- **FR-PVD-008**: SHALL bind providers to lanes so that provider failures isolate to the affected lane.
- **FR-PVD-009**: SHALL perform periodic health checks on all registered providers and publish status to the bus.
- **FR-PVD-010**: SHALL implement failover routing when a provider is marked degraded.
- **FR-PVD-011**: SHALL normalize error codes across all provider types (ACP, MCP, A2A) into a common error taxonomy.
- **FR-PVD-012**: SHALL enforce policy gates (spec 023) before executing agent-initiated provider actions.

## INFRASTRUCTURE

### BUS - Local Bus V1 Protocol and Envelope (spec 002)

- **FR-BUS-001**: SHALL define an envelope schema containing: `id`, `correlation_id`, `method` (for commands) or `topic` (for events), `payload`, `timestamp`, `sequence`, and `error` (for responses).
- **FR-BUS-002**: SHALL generate globally unique `id` and `correlation_id` values per spec 005 ID standards.
- **FR-BUS-003**: SHALL maintain a method registry where subsystems register command handlers by method name.
- **FR-BUS-004**: SHALL maintain a topic registry where subsystems register event subscriptions by topic name.
- **FR-BUS-005**: SHALL assign monotonically increasing sequence numbers to events within each topic.
- **FR-BUS-006**: SHALL validate every envelope against the schema before routing; malformed envelopes are rejected with `VALIDATION_ERROR`.
- **FR-BUS-007**: SHALL define an error taxonomy: `VALIDATION_ERROR`, `METHOD_NOT_FOUND`, `HANDLER_ERROR`, `TIMEOUT`, `BACKPRESSURE`.
- **FR-BUS-008**: SHALL propagate correlation_id from originating command through all downstream events.
- **FR-BUS-009**: SHALL deliver events to all subscribers of a topic in deterministic order.
- **FR-BUS-010**: SHALL isolate subscriber failures: one subscriber throwing does not prevent delivery to others.

### ID - ID Standards and Cross-Repo Coordination (spec 005)

- **FR-ID-001**: SHALL define a typed ID format: `{prefix}_{ulid}` where prefix identifies entity type.
- **FR-ID-002**: SHALL define prefixes: `ws` (workspace), `ln` (lane), `ss` (session), `tm` (terminal), `rn` (run), `cor` (correlation).
- **FR-ID-003**: SHALL use ULID (Universally Unique Lexicographically Sortable Identifier) as the ID body.
- **FR-ID-004**: SHALL guarantee global uniqueness: zero collisions expected at 1 million IDs per second per process.
- **FR-ID-005**: SHALL provide a shared ID generation library usable by heliosApp, thegent, trace, and heliosHarness.
- **FR-ID-006**: SHALL provide ID validation that checks prefix, ULID format, and character set.
- **FR-ID-007**: SHALL provide ID parsing that extracts entity type and timestamp from any valid ID.
- **FR-ID-008**: SHALL All generated IDs MUST be URL-safe, filename-safe, and JSON-safe (alphanumeric + underscore only).
- **FR-ID-009**: SHALL maintain monotonic ordering of IDs generated within the same process and millisecond.

## OBSERVABILITY

### AUD - Audit Logging and Session Replay (spec 024)

- **FR-AUD-001**: SHALL capture audit events with structured schema: actor, action, target, result, timestamp, workspace ID, lane ID, session ID, and correlation ID.
- **FR-AUD-002**: SHALL write events to an append-only log; no mutation or deletion of audit records except via retention purge.
- **FR-AUD-003**: SHALL maintain an in-memory ring buffer for hot queries on recent events.
- **FR-AUD-004**: SHALL persist events to SQLite for durable retention of at least 30 days.
- **FR-AUD-005**: SHALL provide search/filter over the audit ledger by workspace, lane, session, actor, time range, event type, and correlation ID.
- **FR-AUD-006**: SHALL capture terminal session state snapshots at configurable intervals for replay reconstruction.
- **FR-AUD-007**: SHALL provide a session replay UI with time-scrubbing, play/pause, and speed controls.
- **FR-AUD-008**: SHALL export audit data as JSON bundles with redaction applied per spec 028 rules.
- **FR-AUD-009**: SHALL enforce configurable retention TTL with automated purge and deletion audit proof.
- **FR-AUD-010**: SHALL support legal hold exceptions that override TTL-based purge.
- **FR-AUD-011**: SHALL record a deletion audit proof (hash chain or equivalent) when purging expired events.

### PRF - Performance Baseline and Instrumentation (spec 006)

- **FR-PRF-001**: SHALL provide instrumentation hooks for: input-to-echo, input-to-render, lane-create, session-restore, and startup-to-interactive.
- **FR-PRF-002**: SHALL compute rolling percentile statistics (p50, p95, p99, min, max, count) for each instrumented metric.
- **FR-PRF-003**: SHALL define SLO thresholds per the constitution: input-to-echo p50 < 30ms / p95 < 60ms, input-to-render p50 < 60ms / p95 < 150ms, 60 FPS target, < 500 MB memory, < 2s startup.
- **FR-PRF-004**: SHALL emit `perf.slo_violation` bus events (via spec 002) when any metric breaches its SLO threshold.
- **FR-PRF-005**: SHALL sample memory usage at configurable intervals (default 5s) and record time-series data.
- **FR-PRF-006**: SHALL sample renderer frame timing and flag any 1-second window below 55 FPS.
- **FR-PRF-007**: SHALL provide a metrics query API returning current statistics for any instrumented metric.
- **FR-PRF-008**: SHALL use monotonic clock sources for all latency measurements.
- **FR-PRF-009**: SHALL bound the metrics buffer (configurable, default 10,000 samples per metric) and drop oldest on overflow.
- **FR-PRF-010**: SHALL rate-limit SLO violation events to at most 1 per metric per 10-second window.

## RENDERING

### GHT - Ghostty Renderer Backend (spec 011)

- **FR-GHT-001**: SHALL The ghostty backend MUST implement the renderer adapter interface defined in spec 010.
- **FR-GHT-002**: SHALL The backend MUST embed or manage the ghostty process/library and bind its render loop to the ElectroBun window surface.
- **FR-GHT-003**: SHALL The backend MUST pipe PTY output streams to ghostty for rendering and relay user input from ghostty back to the PTY.
- **FR-GHT-004**: SHALL The backend MUST support GPU-accelerated rendering within the ElectroBun window.
- **FR-GHT-005**: SHALL The backend MUST collect and publish frame metrics (frame time, FPS, input latency) to the local bus.
- **FR-GHT-006**: SHALL The backend MUST report its capability matrix accurately, reflecting actual runtime GPU and feature availability.
- **FR-GHT-007**: SHALL The backend MUST handle ghostty process crashes by publishing an error event and supporting adapter-level recovery.

### RIO - Rio Renderer Backend (spec 012)

- **FR-RIO-001**: SHALL The rio backend MUST implement the same renderer adapter interface defined in spec 010.
- **FR-RIO-002**: SHALL The rio backend MUST be gated behind a feature flag that is off by default.
- **FR-RIO-003**: SHALL The backend MUST embed or manage the rio process/library and bind its render loop to the ElectroBun window surface.
- **FR-RIO-004**: SHALL The backend MUST pipe PTY output streams to rio for rendering and relay user input from rio back to the PTY.
- **FR-RIO-005**: SHALL The backend MUST collect and publish frame metrics using the same schema as the ghostty backend.
- **FR-RIO-006**: SHALL The backend MUST report its capability matrix accurately, reflecting actual runtime feature availability.
- **FR-RIO-007**: SHALL The backend MUST handle rio process crashes by publishing an error event and supporting adapter-level recovery or fallback.
- **FR-RIO-008**: SHALL reject renderer switch requests to rio when the feature flag is disabled.

### RND - Renderer Adapter Interface (spec 010)

- **FR-RND-001**: SHALL define a renderer adapter interface with lifecycle operations: `init`, `start`, `stop`, `switch`, and `queryCapabilities`.
- **FR-RND-002**: SHALL manage renderer state through a state machine: `uninitialized` -> `initializing` -> `running` -> `switching` -> `stopping` -> `stopped` -> `errored`.
- **FR-RND-003**: SHALL maintain a renderer registry where engines register themselves with identity, version, and capability metadata.
- **FR-RND-004**: SHALL perform renderer switches as transactions with automatic rollback on failure.
- **FR-RND-005**: SHALL support binding and unbinding PTY output streams to the active renderer without data loss.
- **FR-RND-006**: SHALL publish renderer lifecycle events (initialized, started, switched, stopped, errored) to the local bus.
- **FR-RND-007**: SHALL report a structured capability matrix per renderer including at minimum: GPU acceleration, color depth, ligature support, maximum dimensions, and input modes.
- **FR-RND-008**: SHALL enforce that exactly one renderer is active at any time during normal operation.

### TXN - Renderer Switch Transaction (spec 013)

- **FR-TXN-001**: SHALL execute renderer switches as atomic transactions with commit/rollback semantics.
- **FR-TXN-002**: SHALL attempt hot-swap when both source and target renderers support it for the current terminal configuration.
- **FR-TXN-003**: SHALL fall back to restart-with-restore when hot-swap is unavailable, using zmx checkpoint data for session recovery.
- **FR-TXN-004**: SHALL automatically roll back to the previous renderer on any failure during the switch transaction.
- **FR-TXN-005**: SHALL preserve all active PTY streams during the switch; no bytes may be dropped.
- **FR-TXN-006**: SHALL preserve session context (scrollback, cursor position, environment, working directory) across the switch.
- **FR-TXN-007**: SHALL reject concurrent switch requests while a transaction is in progress.
- **FR-TXN-008**: SHALL emit lifecycle events on the internal bus for switch-started, switch-committed, switch-rolled-back, and switch-failed.

## RESILIENCE

### CRH - Crash Recovery and Restoration (spec 027)

- **FR-CRH-001**: SHALL detect abnormal termination of ElectroBun host, runtime daemon, and renderer worker processes via exit code monitoring and watchdog heartbeat timeouts.
- **FR-CRH-002**: SHALL implement a recovery state machine with states: crashed, detecting, inventorying, restoring, reconciling, live, and explicit failure states.
- **FR-CRH-003**: SHALL use zmx checkpoints for terminal session restoration, with checkpoint intervals driven by time-based and activity-based heuristics.
- **FR-CRH-004**: SHALL validate zmx checkpoint integrity before attempting restore.
- **FR-CRH-005**: SHALL reattach zellij sessions, re-inventory par lanes, re-spawn terminal PTYs from zmx checkpoints, and restart renderers during restoration.
- **FR-CRH-006**: SHALL run an orphan reconciliation scan after recovery, integrating with spec 015 orphan detection.
- **FR-CRH-007**: SHALL display a recovery banner/modal with stage indicators and progress during restoration.
- **FR-CRH-008**: SHALL present a "what was recovered" summary upon completion, with clear reporting of unrecoverable items and manual intervention prompts.
- **FR-CRH-009**: SHALL detect crash loops (3+ crashes in 60 seconds) and enter safe mode.
- **FR-CRH-010**: SHALL support partial recovery, restoring everything possible and reporting losses.

### ORF - Lane Orphan Detection and Remediation (spec 015)

- **FR-ORF-001**: SHALL run a periodic watchdog that detects orphaned worktrees not associated with any active lane.
- **FR-ORF-002**: SHALL detect stale zellij sessions that have no corresponding active lane or session binding.
- **FR-ORF-003**: SHALL detect leaked PTY processes that have no parent lane or session.
- **FR-ORF-004**: SHALL present remediation suggestions to the user without performing automatic cleanup.
- **FR-ORF-005**: SHALL require explicit user confirmation before executing any cleanup action.
- **FR-ORF-006**: SHALL classify each orphaned resource by type, age, estimated owning lane, and risk level.
- **FR-ORF-007**: SHALL suppress cleanup suggestions for resources involved in active recovery operations.
- **FR-ORF-008**: SHALL emit detection and remediation events on the internal bus.
- **FR-ORF-009**: SHALL support a configurable detection interval and cooldown for declined cleanup suggestions.

## SECURITY

### APR - Command Policy Engine and Approval Workflows (spec 023)

- **FR-APR-001**: SHALL evaluate every agent-mediated command against workspace-scoped policy rules before execution.
- **FR-APR-002**: SHALL classify commands as safe, needs-approval, or blocked using allowlist/denylist pattern matching.
- **FR-APR-003**: SHALL deny-by-default any command that matches no policy rule.
- **FR-APR-004**: SHALL create approval requests containing command text, affected files, risk classification, agent rationale, and diff context.
- **FR-APR-005**: SHALL support approve and deny actions on pending requests with operator-supplied reason.
- **FR-APR-006**: SHALL enforce configurable timeouts on approval requests with a default action (deny).
- **FR-APR-007**: SHALL persist the approval queue durably so pending requests survive restart.
- **FR-APR-008**: SHALL protect sensitive path patterns (credentials, env files, config) with denylist rules that override allowlist.
- **FR-APR-009**: SHALL provide an approval queue UI panel showing pending requests with context and approve/deny controls.
- **FR-APR-010**: SHALL record every policy evaluation result to the audit log (spec 024).
- **FR-APR-011**: SHALL integrate policy checks into lane execution (par) and terminal command dispatch.

### SEC - Secrets Management and Redaction (spec 028)

- **FR-SEC-001**: SHALL provide a secure per-provider credential store with encryption at rest.
- **FR-SEC-002**: SHALL scope credentials to provider+workspace and prevent cross-provider credential access.
- **FR-SEC-003**: SHALL support credential lifecycle operations: create, rotate, and revoke, each producing an audit event.
- **FR-SEC-004**: SHALL implement a pattern-based redaction engine that detects API keys, tokens, passwords, and connection strings.
- **FR-SEC-005**: SHALL apply redaction at the audit sink boundary, before any content is persisted or exported.
- **FR-SEC-006**: SHALL support configurable redaction rules with operator-tunable patterns.
- **FR-SEC-007**: SHALL warn operators when terminal commands access sensitive file paths (`.env`, `credentials.json`, `**/secrets/**`).
- **FR-SEC-008**: SHALL support a configurable protected path list.
- **FR-SEC-009**: SHALL maintain a credential access audit trail recording every read, write, and delete of credentials.
- **FR-SEC-010**: SHALL maintain a redaction audit trail proving that redaction was applied to each persisted artifact.
- **FR-SEC-011**: SHALL provide redaction verification tests as part of the CI/CD pipeline.

## SHELL

### SHL - Terminal-First Desktop Shell (spec 001)

- **FR-SHL-001**: SHALL fork co(lab) and strip embedded editor, browser, and non-terminal UI surfaces to produce a terminal-first shell.
- **FR-SHL-002**: SHALL bootstrap an ElectroBun desktop shell that reaches interactive state within 2 seconds on reference hardware.
- **FR-SHL-003**: SHALL provide a terminal-first default layout with split panes, tab bar, and sidebar for workspace/project navigation.
- **FR-SHL-004**: SHALL provide a command palette accessible via global keyboard shortcut that supports fuzzy search over registered actions.
- **FR-SHL-005**: SHALL manage window lifecycle: create, close, minimize, maximize, restore geometry, and persist window state across restarts.
- **FR-SHL-006**: SHALL support multiple windows, each independently bound to a workspace context.
- **FR-SHL-007**: SHALL provide tab management for terminal, agent, session, chat, and project views within each window.
- **FR-SHL-008**: SHALL expose a shell-level extension point for subsystems (renderer, mux, bus) to register capabilities and UI surfaces.
- **FR-SHL-009**: SHALL implement graceful shutdown that signals all subsystems and waits for in-flight operations before exit.
- **FR-SHL-010**: SHALL display a degraded-mode banner when a critical subsystem is unavailable, keeping the shell operable for diagnostics.

## STORAGE

### PER - Workspace and Project Metadata Persistence (spec 003)

- **FR-PER-001**: SHALL support workspace CRUD: create (name, root_path), open, close, delete.
- **FR-PER-002**: SHALL enforce unique workspace names within an installation.
- **FR-PER-003**: SHALL support project binding: attach a local directory or git clone URL to a workspace.
- **FR-PER-004**: SHALL validate project root paths on workspace open and flag unreachable paths as `stale`.
- **FR-PER-005**: SHALL persist workspace and project metadata to local storage (JSON for MVP, SQLite for durability phase).
- **FR-PER-006**: SHALL restore all workspace and project metadata on app restart.
- **FR-PER-007**: SHALL detect metadata corruption and offer recovery from last known good snapshot.
- **FR-PER-008**: SHALL block workspace deletion when active sessions exist, surfacing an actionable error.
- **FR-PER-009**: SHALL emit bus events (via spec 002) for workspace lifecycle transitions: `workspace.created`, `workspace.opened`, `workspace.closed`, `workspace.deleted`.
- **FR-PER-010**: SHALL assign each workspace a unique `workspace_id` per spec 005 ID standards.

## UI

### LST - Lane List and Status Display (spec 017)

- **FR-LST-001**: SHALL display a left-rail lane list panel showing all lanes in the active workspace.
- **FR-LST-002**: SHALL Each lane entry MUST display a status badge with distinct colors for idle, running, blocked, error, and shared states.
- **FR-LST-003**: SHALL provide lane create, attach, and cleanup actions accessible from the panel.
- **FR-LST-004**: SHALL Cleanup actions MUST require user confirmation before execution.
- **FR-LST-005**: SHALL update lane status badges in real time via internal bus event subscription.
- **FR-LST-006**: SHALL integrate with orphan detection (spec 015) to flag orphaned lanes with a distinct visual indicator.
- **FR-LST-007**: SHALL support keyboard navigation within the lane list (arrow keys to select, Enter to attach).

### TAB - Workspace Lane Session UI Tabs (spec 016)

- **FR-TAB-001**: SHALL provide tab surfaces for terminal, agent, session, chat, and project views.
- **FR-TAB-002**: SHALL All tabs MUST be bound to the currently active workspace, lane, and session context.
- **FR-TAB-003**: SHALL update all visible tabs when the active lane or session changes.
- **FR-TAB-004**: SHALL provide configurable keyboard shortcuts for switching between tabs.
- **FR-TAB-005**: SHALL display a stale-context indicator on any tab that fails to update after a context switch.
- **FR-TAB-006**: SHALL preserve tab selection state across runtime restarts.
- **FR-TAB-007**: SHALL support tab reordering and pinning as user preferences.

---

## Summary

- **Total Functional Requirements**: 283
- **Categories**: 29
- **Domains**: 15

## Traceability

Each FR SHALL be implemented by code in the heliosApp repository. FR IDs are referenced in:

- Test files via markers: `@pytest.mark.requirement("FR-XXX-NNN")` or `# @trace FR-XXX-NNN`
- Implementation code via docstrings: `Traces to: FR-XXX-NNN`
- Test coverage tracked in `docs/reference/FR_TRACKER.md`
- Code entity mapping in `docs/reference/CODE_ENTITY_MAP.md`

---

## Diagnostics and SLO Instrumentation

Requirements derived from `apps/runtime/src/diagnostics/`.

- **FR-DIAG-001**: SHALL define `MetricType` as union of `"latency" | "gauge" | "counter"` and `MetricDefinition` with fields `name`, `type`, `unit`, `description`, and optional `bufferSize`.
  **Code:** `apps/runtime/src/diagnostics/types.ts`

- **FR-DIAG-002**: SHALL define `Sample` with fields `timestamp` (number), `value` (number), and optional `labels` (Record<string,string>); labels MUST be omittable on hot paths to avoid allocation.
  **Code:** `apps/runtime/src/diagnostics/types.ts`

- **FR-DIAG-003**: SHALL define `PercentileBucket` with fields `p50`, `p95`, `p99`, `min`, `max`, `count`; all fields are readonly numbers.
  **Code:** `apps/runtime/src/diagnostics/types.ts`

- **FR-DIAG-004**: SHALL define `SLODefinition` with fields `metric` (string), `percentile` ("p50"|"p95"|"p99"), `threshold` (number), `unit` (string); SLO definitions drive automated alerting when thresholds are breached.
  **Code:** `apps/runtime/src/diagnostics/types.ts`

- **FR-DIAG-005**: SHALL emit `SLOViolationEvent` with fields `metric`, `percentile`, `threshold`, `actual`, `timestamp` whenever a recorded sample causes a registered SLO to be breached.
  **Code:** `apps/runtime/src/diagnostics/types.ts`

- **FR-DIAG-006**: SHALL implement `samplers.ts` providing per-metric circular sample buffers with configurable `bufferSize`; oldest samples SHALL be overwritten on overflow without blocking.
  **Code:** `apps/runtime/src/diagnostics/samplers.ts`

- **FR-DIAG-007**: SHALL implement `percentiles.ts` computing `PercentileBucket` from a sample buffer using a sort-and-index algorithm; computation MUST be synchronous and complete in O(n log n) where n is the buffer size.
  **Code:** `apps/runtime/src/diagnostics/percentiles.ts`

- **FR-DIAG-008**: SHALL implement `query.ts` exposing a `MetricsQuery` interface with `getMetric(name: string): PercentileBucket | undefined` and `listMetrics(): string[]`.
  **Code:** `apps/runtime/src/diagnostics/query.ts`

- **FR-DIAG-009**: SHALL implement `slo.ts` with an `SLOMonitor` class that accepts `SLODefinition[]`, evaluates each after every sample record, and emits `SLOViolationEvent` to registered listeners.
  **Code:** `apps/runtime/src/diagnostics/slo.ts`
