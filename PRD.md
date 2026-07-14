# Product Requirements Document — heliosApp

**Status:** ACTIVE
**Owner:** Phenotype Engineering
**Last Updated:** 2026-03-26
**Version:** 2.0

---

## Overview

heliosApp is a native desktop application and runtime for agent-driven software engineering. It provides a unified interface for developers and AI agents to collaborate within isolated workspace lanes, each containing PTY terminal sessions, multiplexed shell environments, and a local bus protocol for command/event coordination. The system is built as a Bun monorepo (`apps/runtime`, `apps/desktop`) with TypeScript throughout, targeting macOS (Apple Silicon) and Linux (NVIDIA GPU) as primary platforms.

The MVP target is a persistent chat-plus-terminal interface where a user can issue natural language prompts, observe real-time streamed responses, watch the agent's tool calls inline, and interact with spawned terminal sessions — all within a single desktop application.

---

## E1: Runtime Orchestration

### E1.1: Local Bus Protocol
As the runtime, I want a unified message bus so that workspace, lane, session, and terminal entities can communicate via typed commands, events, and responses without tight coupling.

**Acceptance Criteria:**
- `LocalBusEnvelope` protocol with three envelope types: command (method-based), event (topic-based pub/sub), response (success or error).
- All envelopes carry: `id`, `correlation_id`, `type`, `ts`, and context IDs (`workspace_id`, `lane_id`, `session_id`, `terminal_id`).
- Correlation tracking via `correlation_id` links commands to their events and responses.
- Lifecycle ordering enforcement: state machine transitions are validated and invalid ordering is rejected.
- `InMemoryLocalBus` and `BoundaryDispatcher` implementations both satisfy the bus interface.

**Code:** `apps/runtime/src/protocol/bus.ts`, `apps/runtime/src/protocol/types.ts`, `apps/runtime/src/protocol/methods.ts`

### E1.2: Workspace and Lane Management
As a developer, I want to create workspaces containing named lanes so that I can organize parallel agent sessions with independent state.

**Acceptance Criteria:**
- Workspace CRUD: create, read, list, delete. Each workspace has a unique ID, name, and persistent metadata.
- Lane CRUD within a workspace. Lanes support PAR (parallel) execution mode.
- Lane-to-session binding: a lane can hold one or more sessions.
- Lane state machine: `idle -> active -> paused -> terminated`.
- Orphan detection: lanes without active sessions after a timeout are flagged for remediation.
- Workspace and lane metadata persisted to durable storage across restarts.

**Code:** `apps/runtime/src/workspace/`, `apps/runtime/src/lanes/`

### E1.3: Session and Terminal Lifecycle
As a developer, I want to attach sessions to lanes and spawn PTY terminals so that agents and users can execute commands in real shell environments.

**Acceptance Criteria:**
- Session attach/detach with state machine (`created -> attaching -> attached -> detaching -> detached -> terminated`).
- `PTYLifecycleManager` spawns real PTY processes using the user's default shell.
- Terminal output streamed with full ANSI color and cursor support.
- Terminal resize events propagated to the PTY process.
- Multiple concurrent terminal instances supported.
- PTY idle monitoring: terminals inactive beyond a threshold trigger a watchdog scan.
- Zellij mux adapter available for multiplexed multi-pane session management.

**Code:** `apps/runtime/src/pty/`, `apps/runtime/src/sessions/`, `apps/runtime/src/integrations/zellij/`

---

## E2: Desktop Application

### E2.1: Tauri Desktop Shell
As a user, I want a native desktop application so that I can interact with the runtime visually with OS-level integration.

**Acceptance Criteria:**
- Tauri-based desktop app (`apps/desktop`) with TypeScript renderer.
- Desktop app communicates with runtime via local bus client (`runtime_client.ts`).
- Application launches on macOS and Linux without requiring Node.js in the environment.
- App settings persisted across restarts (preferred model, theme, keybindings).

**Code:** `apps/desktop/src/`, `apps/desktop/src/runtime_client.ts`

### E2.2: Chat Interface
As a user, I want a persistent chat interface with real-time streaming so that I can issue natural language prompts and observe agent responses token by token.

**Acceptance Criteria:**
- Left sidebar: conversation history and navigation.
- Center panel: active chat conversation with streaming output.
- Bottom input area: model selector and send controls.
- Agent tool calls (file reads, writes, terminal commands) rendered inline in the chat.
- Multi-turn conversations with full context retention.
- Interrupt/cancel in-progress agent actions.
- All conversations persisted across app restarts.

**Code:** `apps/desktop/src/pages/`, `apps/desktop/src/panels/`

### E2.3: Terminal Panels
As a user, I want integrated terminal panels so that I can observe and interact with the shell sessions the agent is using.

**Acceptance Criteria:**
- Terminal panels displayable in bottom or side layout.
- ANSI color and cursor rendering.
- Terminal resize propagated to PTY.
- Agent can execute commands in any open terminal panel.
- Keyboard shortcut to toggle terminal visibility.

**Code:** `apps/desktop/src/panels/`, `apps/runtime/src/runtime/terminal.ts`

### E2.4: Tabs and Lane Navigation
As a user, I want tab-based navigation between workspaces and lanes so that I can switch context without losing state.

**Acceptance Criteria:**
- Tab bar showing open workspaces and lanes.
- Tab creation, closing, and reordering.
- Active tab state persisted.
- Lane status visible in tabs (idle, active, error).

**Code:** `apps/desktop/src/tabs.ts`, `apps/desktop/src/tabs/`

---

## E3: Provider and Extension System

### E3.1: Multi-Backend Inference
As a developer, I want to switch between cloud and local inference providers so that I can use the best available model for my hardware and connectivity.

**Acceptance Criteria:**
- At least one cloud provider: Anthropic API.
- Local inference on Apple Silicon via MLX.
- Local inference on NVIDIA GPU via llama.cpp.
- Auto-detect available hardware at startup.
- Switch providers without losing conversation state.
- Graceful fallback when a selected provider becomes unavailable.

**Code:** `apps/runtime/src/providers/`

### E3.2: Provider Adapter Interface
As a developer, I want a pluggable provider adapter interface so that new AI providers can be added without modifying core runtime.

**Acceptance Criteria:**
- `ProviderAdapter` interface with lifecycle hooks: `initialize`, `generate`, `stream`, `dispose`.
- Provider registry for discovery and management.
- Configuration per-provider stored in app settings.
- MCP (Model Context Protocol) adapter bridge for MCP-compliant tools and servers.

**Code:** `apps/runtime/src/providers/`, `apps/runtime/src/integrations/`

---

## E4: Observability and Security

### E4.1: Audit Logging and Session Replay
As an operator, I want audit logging of all bus events so that I can review and replay agent actions post-hoc.

**Acceptance Criteria:**
- Audit subscriber captures all bus envelopes with monotonic sequence numbers per topic.
- Audit records include: `id`, `type`, `topic/method`, `correlation_id`, `timestamp`, `payload`, `outcome` (accepted/rejected), `validation_errors`.
- Queryable by topic, `correlation_id`, or time range.
- Session replay reconstructs system state from audit trail.
- Audit log retained with configurable retention policy.

**Code:** `apps/runtime/src/audit/`

### E4.2: Secrets Management and Redaction
As a developer, I want secure secret handling so that credentials are never exposed in terminal sessions or event logs.

**Acceptance Criteria:**
- `RedactionEngine` scrubs sensitive patterns from all bus events before logging.
- Default redaction rules cover common secret patterns (API keys, tokens, passwords).
- Secret injection into terminal environments without exposing values in command arguments.
- Secrets module with encrypted storage.

**Code:** `apps/runtime/src/secrets/redaction-engine.ts`, `apps/runtime/src/secrets/redaction-rules.ts`

### E4.3: Command Policy Engine
As an operator, I want a policy engine that can approve or block agent commands so that I can enforce safety constraints without disabling the agent.

**Acceptance Criteria:**
- Policy rules defined per command method.
- Approval workflow: commands can be held pending explicit user approval.
- Blocked commands produce a clear rejection event (not a silent drop).
- Policy state persisted across sessions.

**Code:** `apps/runtime/src/policy/`

---

## E5: Resilience and Recovery

### E5.1: Crash Recovery
As a developer, I want session state checkpointed periodically so that a crash does not lose more than one checkpoint interval of work.

**Acceptance Criteria:**
- `RecoveryRegistry` tracks all active sessions and their last checkpoint.
- Checkpoint written on session state transitions and on a periodic timer.
- On restart, `RecoveryBootstrapResult` identifies recoverable vs. unrecoverable sessions.
- Orphaned lanes (no session reattached within timeout) are remediated.

**Code:** `apps/runtime/src/sessions/registry.ts`, `apps/runtime/src/recovery/`

### E5.2: Performance Baseline
As a developer, I want runtime instrumentation so that I can detect regressions and set performance budgets.

**Acceptance Criteria:**
- Latency instrumentation on bus command dispatch and PTY output streaming.
- PTY output backpressure metrics: queue depth and backlog size.
- Performance baseline exported in a structured format for CI comparison.

**Code:** `apps/runtime/src/diagnostics/`

---

## E6: Collaboration

### E6.1: Session Sharing
As a developer, I want to share terminal sessions with collaborators or external tools so that pair programming and tool integration are possible.

**Acceptance Criteria:**
- Share session via tty-share or equivalent external tool.
- Share URL generated and displayed to the user.
- Shared session read-only by default; write access requires explicit grant.
- Session sharing state visible in the lane UI.

**Code:** `apps/runtime/src/` (share integration)

---

## E7: Build, CI, and Dependency Management

### E7.1: Monorepo Build System
As a developer, I want a unified build system so that all packages build, lint, and test with a single command.

**Acceptance Criteria:**
- Bun workspaces with `apps/runtime` and `apps/desktop` as packages.
- `bun run build` produces a production-optimized desktop bundle.
- `bun run typecheck` runs TypeScript strict-mode check across all packages (exit non-zero on error).
- Biome linting and formatting enforced across all TypeScript source.
- Taskfile for standard targets: `lint`, `test`, `build`, `typecheck`.

**Code:** `package.json`, `Taskfile.yml`, `biome.json`, `tsconfig.base.json`

### E7.2: Dependency Management
As a developer, I want automated dependency tracking and rollback so that prerelease dependency upgrades do not silently break the build.

**Acceptance Criteria:**
- Dependency registry manifest tracking each prerelease dep: name, current pin, channel, upstream source, known-good history.
- `bun run deps:status` reports current state and available upgrades.
- `bun run deps:rollback <package>` atomically reverts to last known-good pin.
- Every upgrade attempt recorded in structured `deps-changelog.json` with timestamp, versions, gate results, and actor.
- Canary process: isolated branch, upgrade, full quality gates, auto-merge on pass or issue on failure.

**Code:** `deps-registry.json`, `deps-changelog.json`

---

## Future Roadmap

- **Phase 2**: Remote workspace sync across machines.
- **Phase 3**: Multi-user collaborative lanes with CRDT-based state.
- **Phase 4**: Plugin marketplace for provider adapters and MCP tools.
- **Phase 5**: Cloud-hosted runtime for fully remote agent execution.
