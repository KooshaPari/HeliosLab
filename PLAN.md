# Implementation Plan — heliosApp

**Status:** Active
**Owner:** Phenotype Engineering
**Last Updated:** 2026-03-27
**Version:** 2.0

---

## Overview

This plan covers all implementation phases for heliosApp: a native desktop application and runtime for agent-driven software engineering. Phases are ordered by dependency; tasks within a phase may run in parallel unless noted. Every task ID (P{phase}.{task}) is unique and used as a DAG node.

### Completion Key

| Symbol | Meaning |
|--------|---------|
| Done | Merged to main, all gates green |
| In Progress | Active development, branch open |
| Planned | Scoped, not yet started |
| Blocked | Waiting on explicit predecessor |

---

## Dependency DAG

```
P1.1 --> P2.1 --> P2.2 --> P2.3 --> P2.4 --> P2.5
P1.2 (no deps)
P1.3 --> P3.1 --> P3.2 --> P3.3
P1.1 --> P3.3
P2.1 --> P4.1 --> P4.2
P2.3 --> P4.3
P2.3 --> P5.1
P2.1 --> P5.2 --> P5.4
P2.1 --> P5.3 --> P5.4
P3.1 --> P6.1
P3.2 --> P6.1
P3.3 --> P6.1
P4.1 --> P4.4
P4.2 --> P4.4
P5.1 --> P7.1
P5.2 --> P7.1
P5.3 --> P7.1
P6.1 --> P7.2
P7.1 --> P8.1
P7.2 --> P8.1
```

---

## Phase 1: Core Protocol and Infrastructure (Done)

Foundation layer: message bus protocol, ID standards, and monorepo build system. All downstream phases depend on this phase.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P1.1 | LocalBus envelope protocol (command/event/response types, correlation tracking, state machine validation) | — | `apps/runtime/src/protocol/` | FR-BUS-001–010 | Done |
| P1.2 | ID standards and cross-repo coordination (UUID strategy, entity ID namespacing) | — | `apps/*/src/ids/` | FR-ID-001–009 | Done |
| P1.3 | Bun monorepo with workspace structure (root `package.json`, `tsconfig.base.json`, `biome.json`, Taskfile, justfile) | — | `/package.json`, `/Taskfile.yml` | FR-RUN-001–008 | Done |

**Phase 1 acceptance milestone:** `bun run typecheck` exits 0 on root; bus envelopes round-trip with correct correlation IDs; all ID generation is deterministic and namespaced.

---

## Phase 2: Runtime Core (Done)

Runtime orchestration: workspaces, lanes, sessions, PTYs, and the Zellij multiplexer adapter. Entirely server-side; no UI dependency.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P2.1 | Workspace state management (create/read/list/delete, persistent metadata, durable storage) | P1.1 | `apps/runtime/src/workspace/` | FR-PER-001–010 | Done |
| P2.2 | PAR lane orchestrator (lane CRUD, state machine `idle→active→paused→terminated`, registry, watchdog) | P2.1 | `apps/runtime/src/lanes/` | FR-LAN-001–008 | Done |
| P2.3 | Session lifecycle and binding (attach/detach state machine, terminal-to-lane-session binding) | P2.2 | `apps/runtime/src/sessions/`, `apps/runtime/src/protocol/` | FR-BND-001–008 | Done |
| P2.4 | PTY lifecycle manager (spawn via `Bun.spawn`, idle monitor, resize events, ANSI streaming) | P2.3 | `apps/runtime/src/pty/` | FR-PTY-001–008 | Done |
| P2.5 | Zellij mux session adapter (layout management, pane binding, lifecycle tied to lane) | P2.4 | `apps/runtime/src/integrations/zellij/` | FR-ZMX-001–008 | Done |

**Phase 2 acceptance milestone:** A workspace can be created, a lane attached, a PTY spawned, terminal output streamed with ANSI intact, and all state transitions emit well-formed bus events.

---

## Phase 3: Desktop and Renderer (In Progress)

Client-facing layer: Tauri desktop shell, terminal renderer UI, and the runtime-desktop integration path.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P3.1 | Tauri desktop shell (native macOS/Linux app, runtime client, app settings persistence, launch without Node.js) | P1.3 | `apps/desktop/src/`, `apps/desktop/src/runtime_client.ts` | FR-SHL-001–010, FR-CFG-001–010 | In Progress |
| P3.2 | Terminal renderer UI (Ghostty and Rio backends, `RendererAdapter` interface, hot-swap transaction, capabilities) | P3.1 | `apps/renderer/`, `apps/runtime/src/renderer/` | FR-RND-001–008, FR-GHT-001–007, FR-RIO-001–008, FR-TXN-001–008, FR-ENG-001–008 | In Progress |
| P3.3 | Runtime-desktop integration via bus (IPC bridge, chat interface, streaming output, tool call rendering, tab navigation) | P3.1, P1.1 | `apps/desktop/src/pages/`, `apps/desktop/src/panels/`, `apps/desktop/src/tabs/` | FR-MVP-001–027 | In Progress |

**Phase 3 acceptance milestone:** Desktop app launches natively; user can open a chat, issue a prompt, observe streamed tokens; terminal panel renders PTY output with ANSI; tabs switch between lanes without state loss.

---

## Phase 4: Extensions and Providers (Planned)

Pluggable inference and tool provider system, provider registry, and session sharing workflows.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P4.1 | Provider adapter interface (lifecycle hooks: `initialize`, `generate`, `stream`, `dispose`; MCP adapter bridge) | P2.1 | `apps/runtime/src/providers/`, `apps/runtime/src/integrations/` | FR-PVD-001–012 | Planned |
| P4.2 | Provider registry (discovery, registration, per-provider config in app settings) | P4.1 | `apps/runtime/src/providers/registry.ts` | FR-PVD-003, FR-PVD-007 | Planned |
| P4.3 | Share session workflows (tty-share integration, share URL generation, read-only default, explicit write grant) | P2.3 | `apps/runtime/src/` (share integration) | FR-SHR-001–011 | Planned |
| P4.4 | Multi-backend inference (Anthropic API, MLX for Apple Silicon, llama.cpp for NVIDIA, hardware auto-detect, graceful fallback) | P4.1, P4.2 | `apps/runtime/src/providers/` | FR-MVP-014–019 | Planned |

**Phase 4 acceptance milestone:** Anthropic API provider works end-to-end; `ProviderAdapter` interface has passing unit tests for lifecycle hooks; `deps:status` and `deps:rollback` commands work.

---

## Phase 5: Observability and Security (Planned)

Audit trail, secrets management, crash recovery, diagnostics, and command policy engine.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P5.1 | Audit logging and session replay (bus subscriber capturing all envelopes, monotonic sequences, queryable, session replay) | P2.3 | `apps/runtime/src/audit/` | FR-AUD-001–011 | Planned |
| P5.2 | Secrets management and redaction (`RedactionEngine`, default rules, secret injection into PTY env, encrypted storage) | P2.1 | `apps/runtime/src/secrets/` | FR-SEC-001–011 | Planned |
| P5.3 | Diagnostics and crash recovery (`RecoveryRegistry`, checkpoint scheduler, `RecoveryBootstrapResult`, orphan remediation, safe mode) | P2.1 | `apps/runtime/src/recovery/`, `apps/runtime/src/diagnostics/` | FR-CRH-001–010, FR-ORF-001–009, FR-PRF-001–010 | Planned |
| P5.4 | Command policy engine (per-method rules, approval workflow, explicit rejection event, persistent policy state) | P5.2, P5.3 | `apps/runtime/src/policy/` | FR-APR-001–011 | Blocked |

**Phase 5 acceptance milestone:** All bus events are captured in the audit log with monotonic sequences; sensitive patterns are scrubbed before log writes; a simulated crash followed by restart restores sessions within one checkpoint interval.

---

## Phase 6: MVP Integration (Planned)

End-to-end MVP delivery: full chat-plus-terminal desktop experience with working providers and lanes.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P6.1 | MVP end-to-end integration (chat interface, streaming agent responses, inline tool calls, terminal panels, tab navigation) | P3.1, P3.2, P3.3 | `apps/desktop/src/` | FR-MVP-001–027 | Planned |
| P6.2 | Performance baseline and instrumentation (latency on bus dispatch, PTY streaming backpressure metrics, CI comparison) | P3.3 | `apps/runtime/src/diagnostics/` | FR-PRF-001–010 | Planned |
| P6.3 | Renderer engine settings control (settings UI for switching renderer, per-session engine selection, capability display) | P3.2 | `apps/desktop/src/settings/` | FR-ENG-001–008 | Planned |

**Phase 6 acceptance milestone:** A developer can start the app, open a workspace, issue a natural language prompt, observe streamed agent response with inline tool calls, switch lanes, and quit — with all state recovered on next launch.

---

## Phase 7: Quality and CI/CD (Partially Done)

Automated quality gates, dependency registry, policy enforcement, and documentation.

| Task | Description | Depends On | Code Location | FR Traces | Status |
|------|-------------|------------|---------------|-----------|--------|
| P7.1 | GitHub Actions CI workflows (lint-test, security, build, docs; blocking gates; structured failure reports) | P5.1, P5.2, P5.3 | `.github/workflows/` | FR-CI-001–011 | Done |
| P7.2 | Policy gate and stage gates (required check names guard, stage-gated merge enforcement) | P6.1 | `.github/workflows/stage-gates.yml`, `.github/workflows/policy-gate.yml` | FR-REV-001–010 | Done |
| P7.3 | Prerelease dependency registry (`deps:status`, `deps:rollback`, structured changelog, canary process) | — | `deps-registry.json`, `deps-changelog.json` | FR-DEP-001–008 | Done |
| P7.4 | VitePress documentation (API reference, guides, architecture diagrams, automatic build in CI) | — | `docs/`, `.github/workflows/vitepress-pages.yml` | — | Done |

**Phase 7 acceptance milestone:** Every PR gate runs in CI; `bun run gates` locally reproduces CI results exactly; security scan produces structured JSON output; all docs build without errors.

---

## Phase 8: Hardening and Future Work (Roadmap)

Post-MVP roadmap items: remote sync, multi-user lanes, plugin marketplace, cloud runtime.

| Task | Description | Depends On | FR Traces | Status |
|------|-------------|------------|-----------|--------|
| P8.1 | Remote workspace sync (CRDT-based state, conflict resolution, cross-machine lane handoff) | P7.1, P7.2 | — | Roadmap |
| P8.2 | Multi-user collaborative lanes (concurrent editing, CRDT, access control per lane) | P8.1 | — | Roadmap |
| P8.3 | Plugin marketplace (provider adapter distribution, MCP tool registry, versioned contracts) | P4.2 | — | Roadmap |
| P8.4 | Cloud-hosted runtime (fully remote agent execution, auth, billing, resource isolation) | P8.2 | — | Roadmap |

---

## Cross-References

- **PRD**: `PRD.md` — Epics E1–E7 with acceptance criteria
- **Functional Requirements**: `FUNCTIONAL_REQUIREMENTS.md` — FR-{CAT}-{NNN} requirements
- **Architecture Decisions**: `ADR.md` — ADR-001–020 with rationale and code locations
- **User Journeys**: `USER_JOURNEYS.md` — UJ-1 through UJ-5
- **Kitty Specs**: `kitty-specs/` — 29 detailed specification documents
- **Code Entity Map**: `docs/reference/CODE_ENTITY_MAP.md` — forward/reverse code-to-requirement mapping
