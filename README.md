# HeliosApp

> **Work state:** ACTIVE · **Progress:** `stable` · Updated 2026-06-08 (hygiene bundle).


[![Build](https://img.shields.io/github/actions/workflow/status/KooshaPari/heliosApp/ci.yml?branch=main&label=build)](https://github.com/KooshaPari/heliosApp/actions)
[![Release](https://img.shields.io/github/v/release/KooshaPari/heliosApp?include_prereleases&sort=semver)](https://github.com/KooshaPari/heliosApp/releases)
[![License](https://img.shields.io/github/license/KooshaPari/heliosApp)](LICENSE)
[![Phenotype](https://img.shields.io/badge/Phenotype-org-blueviolet)](https://github.com/KooshaPari)
[![AI Slop Inside](https://sladge.net/badge.svg)](https://sladge.net)

**Status:** stable

**Version:** 2026.03A.0  
**Package Manager:** Bun 1.2.20+  
**Runtime:** TypeScript 7.x (strict mode)

HeliosApp is a developer-focused AI runtime environment with a desktop shell, terminal multiplexing, session management, and multi-provider AI inference. It is structured as a Bun monorepo containing four applications and five shared packages.

## Quick Start

```bash
bun install && bun run dev
```

This boots the desktop shell (`apps/desktop`) in watch mode. Use `bun run dev:runtime` or `bun run dev:colab` to launch the runtime engine or colab renderer instead.

> TODO: add desktop shell screenshot to README (`screenshot.png`).

---

## Architecture Overview

HeliosApp follows an **event-driven monorepo architecture** built around a central message bus (LocalBus V1) that coordinates all subsystems through typed command/event/response envelopes.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Desktop Shell                            │
│  (ElectroBun-based UI: tabs, panels, settings, context store)   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ LocalBus (in-process message bus)
┌──────────────────────────▼──────────────────────────────────────┐
│                       Runtime Engine                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Sessions │ │   PTY    │ │ Providers│ │ Recovery │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  Audit   │ │ Secrets  │ │  Policy  │ │Diagnostics│          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │Integrations││ Config  │ │ Registry │ │ Workspace│          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP API (Bun fetch handler)
┌──────────────────────────▼──────────────────────────────────────┐
│                       Web Renderer                              │
│  (SolidJS SPA: terminal, chat, sidebar, status bar)             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

- **Event-Driven LocalBus** -- Central in-process message bus with 26 registered methods and 40 topics. Uses typed envelopes (Command, Event, Response) with correlation tracking, monotonically increasing sequence numbers, and lifecycle ordering enforcement.
- **State Machines** -- Every lifecycle-critical entity uses an explicit state machine: Lane (8 states), Session (6 states), PTY (6 states), Renderer (7 states), Recovery (6 states).
- **Adapter/Plugin Pattern** -- Pluggable providers for AI inference (Anthropic, MLX, llama.cpp, vLLM), terminal multiplexers (Zellij, PAR), session sharing (upterm, tmate), and renderer backends (Ghostty, Rio).
- **Red-Black Transactions** -- Atomic renderer switching with automatic rollback on failure.
- **Append-Only Audit Log** -- SQLite-backed durable event storage with 30-day retention, in-memory ring buffer for hot queries, and session replay capability.

---

## Project Structure

```
heliosApp/
├── apps/
│   ├── runtime/           # Core runtime engine (bus, PTY, sessions, providers, audit, recovery)
│   ├── desktop/           # Desktop shell (tabs, panels, settings, context store)
│   ├── renderer/          # Standalone SolidJS web renderer (terminal + chat UI)
│   └── colab-renderer/    # Collaborative SolidJS renderer (multi-user)
├── packages/
│   ├── runtime-core/      # Shared types, API client, config helpers, ID utilities
│   ├── ids/               # ULID-based ID generation (ws_, ln_, ss_, tm_, cor_ prefixes)
│   ├── errors/            # Error type definitions
│   ├── logger/            # Pino-based structured logging
│   └── types/             # Base TypeScript type definitions
├── docs/                  # VitePress documentation site (multi-language)
├── specs/                 # Protocol specifications (envelope schema, methods, topics)
├── scripts/               # Build scripts, dependency management, governance tools
├── tools/                 # Gate testing fixtures and tools
└── .github/workflows/     # 18 CI/CD workflow files
```

---

## Key Components

### Runtime Engine (`apps/runtime`)

The core of HeliosApp. Handles all business logic, process management, and inter-component communication.

| Module | Responsibility |
|---|---|
| **protocol/** | LocalBus V1: typed envelopes, method registry (26 methods), topic registry (40 topics), validation, lifecycle ordering |
| **sessions/** | Session lifecycle management (created→attaching→attached→detaching→detached→terminated), lane state machine, terminal buffering with backpressure |
| **pty/** | PTY process lifecycle (idle→spawning→active→throttled→errored→stopped), signal delivery (SIGTERM/SIGKILL/SIGWINCH/SIGHUP), bounded output buffers |
| **providers/** | Pluggable AI provider adapter, ACP client for Claude, A2A federation router, MCP tool bridge, health monitoring |
| **recovery/** | Crash detection, periodic checkpointing with activity-based heuristics, orphan reconciliation, safe mode for crash loops (3+ crashes in 60s) |
| **audit/** | Append-only audit ledger, SQLite persistence, in-memory ring buffer, session replay, retention TTL, export bundles |
| **secrets/** | Pattern-based secret redaction, encrypted credential store, protected path detection, credential access audit trail |
| **policy/** | Deny-by-default command policy engine, approval workflows, persistent approval queue |
| **registry/** | Terminal-to-lane-session binding triple validation, lifecycle events, durable persistence |
| **config/** | Typed settings schema, feature flags, hot-reload support, persistence |
| **diagnostics/** | Performance instrumentation, rolling percentiles (p50/p95/p99), SLO monitoring, memory sampling |
| **integrations/** | Zellij mux adapter, PAR lane orchestrator, session sharing (upterm/tmate), inference adapters (Anthropic/MLX/llama.cpp/vLLM), MCP bridge |
| **workspace/** | Workspace CRUD operations, project management |

### Desktop Shell (`apps/desktop`)

| Module | Responsibility |
|---|---|
| **EditorlessControlPlane** | Main orchestrator: context store, runtime client, settings, tab management |
| **runtime_client.ts** | Desktop-to-runtime communication via LocalBus |
| **context_store.ts** | Active context state (workspace/lane/session/tab) |
| **tabs/** | 5 tab surfaces: terminal, agent, session, chat, project |
| **panels/** | Lane list, status badges, lane actions, confirmation dialogs, keyboard navigation |
| **settings/** | Renderer preferences, hotswap toggle, capability display, settings lock |

### Web Renderer (`apps/renderer`)

SolidJS-based standalone web UI.

| Module | Responsibility |
|---|---|
| **App.tsx** | Root component with terminal panel and tabs |
| **components/chat/** | ChatPanel, ChatInput, MessageBubble, ToolCallBlock, ToolResultBlock |
| **components/terminal/** | TerminalPanel, TerminalTabs (xterm.js integration) |
| **components/sidebar/** | Sidebar with conversation list |
| **stores/** | SolidJS signal-based stores: app, chat, terminal |

### Shared Packages

| Package | Responsibility |
|---|---|
| **@helios/runtime-core** | Shared types (Conversation, Message, Workspace, Lane, Session, Terminal), Anthropic API client (ky-based), config helpers, ID utilities |
| **@helios/ids** | ULID-based ID generation with typed prefixes, validation, parsing |
| **@helios/logger** | Pino-based structured logger |
| **@helios/errors** | Error type definitions |
| **@helios/types** | Base TypeScript type definitions |

---

## Setup Instructions

### Prerequisites

- **Bun** >= 1.2.20
- **Node.js** >= 20.0.0
- **macOS** or **Linux** (Windows WSL2 supported)

### Installation

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Clone and install dependencies
git clone <repository-url>
cd heliosApp
bun install --frozen-lockfile
```

### Development

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Run unit tests
bun run test

# Run integration tests
bun run test:integration

# Run E2E tests
bun run test:e2e

# Run full test suite with coverage
bun run test:coverage

# Run quality gates (typecheck + lint + tests + coverage + security)
bun run gates

# Start documentation dev server
bun run docs:dev
```

### Task Runner Commands

The project supports both [go-task](https://taskfile.dev/) and [just](https://github.com/casey/just):

```bash
# Quick quality checks
task quality:quick    # or: just quality-quick

# Strict quality checks
task quality:strict   # or: just quality-strict

# Full preflight (deps + typecheck + lint + test)
task preflight        # or: just preflight
```

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (primary inference provider) | *(required)* |
| `HELIOS_ACP_API_KEY` | Anthropic API key (fallback via ACP) | *(optional)* |
| `HELIOS_DEFAULT_MODEL` | Default chat model | `claude-sonnet-4-20250514` |
| `ANTHROPIC_BASE_URL` | API base URL override (for proxies/custom endpoints) | `https://api.anthropic.com` |
| `NODE_ENV` | Environment mode | `production` |

---

## API Documentation

### HTTP API

The runtime exposes an HTTP API via Bun's native `fetch` handler (`createRuntime().fetch()`):

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/protocol/dispatch` | Dispatch commands via BoundaryDispatcher |
| `POST` | `/v1/workspaces/{id}/lanes` | Create a new lane in a workspace |
| `POST` | `/v1/workspaces/{id}/lanes/{laneId}/sessions` | Attach/create session with transport negotiation |
| `POST` | `/v1/workspaces/{id}/lanes/{laneId}/terminals` | Spawn a terminal in a lane |
| `POST` | `/v1/workspaces/{id}/lanes/{laneId}/cleanup` | Cleanup a lane and its resources |
| `GET` | `/v1/harness/cliproxy/status` | Check cliproxy harness availability |

### LocalBus Methods (26)

The internal message bus supports these methods:

**Workspace & Project:** `workspace.create`, `workspace.open`, `project.clone`, `project.init`

**Session & Terminal:** `session.create`, `session.attach`, `session.terminate`, `terminal.spawn`, `terminal.resize`, `terminal.input`

**Lane Management:** `lane.create`, `lane.attach`, `lane.cleanup`

**Renderer:** `renderer.switch`, `renderer.capabilities`

**Agent:** `agent.run`, `agent.cancel`

**Sharing:** `share.upterm.start`, `share.upterm.stop`, `share.tmate.start`, `share.tmate.stop`

**Zellij:** `zmx.checkpoint`, `zmx.restore`

**Policy:** `approval.request.resolve`

**Boundary Dispatch:** `boundary.local.dispatch`, `boundary.tool.dispatch`, `boundary.a2a.dispatch`

### LocalBus Topics (40)

Key topics include: `workspace.opened`, `session.created`, `session.attached`, `terminal.spawned`, `terminal.output`, `lane.created`, `agent.run.started`, `harness.status.changed`, `audit.recorded`, `diagnostics.metric`, and more.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun 1.2.20+ (ESM, native test runner) |
| Language | TypeScript 7.x (strict mode, verbatimModuleSyntax) |
| UI Framework | SolidJS 1.9.x (JSX, signals-based reactivity) |
| Terminal | xterm.js 6.x |
| HTTP Client | ky 1.14.3 |
| Logging | pino 10.x |
| Build | esbuild 0.27.x + esbuild-plugin-solid |
| Testing | Bun test runner (unit), Playwright 1.58 (e2e), happy-dom 20.x (DOM shim) |
| Linting | Biome 2.4.9, oxlint |
| Docs | VitePress 1.6.4 |
| Task Orchestration | Turborepo, go-task, just |
| CI/CD | GitHub Actions (18 workflows) |
| AI Providers | Anthropic (primary), MLX (Apple Silicon), llama.cpp/vLLM (NVIDIA GPU) |
| Protocols | ACP, MCP, A2A |

---

## Data Models

### Core Entities

| Entity | Key Fields |
|---|---|
| **Workspace** | `id`, `name`, `rootPath`, `state` (active/closed/deleted) |
| **Lane** | `id`, `workspaceId`, `state` (creating/active/closed/failed) |
| **Session** | `id`, `laneId`, `terminalId`, `workspaceId`, `state` (active/detached/terminated) |
| **Terminal** | `id`, `sessionId`, `state` (spawning/running/throttled/closed) |
| **Conversation** | `id`, `title`, `messages[]`, `modelId`, `createdAt`, `updatedAt` |
| **Message** | `id`, `role` (user/assistant/system/tool_call/tool_result), `content`, `timestamp` |

### Protocol Envelopes

- **CommandEnvelope** -- Method-based dispatch with workspace/lane/session/terminal context
- **EventEnvelope** -- Topic-based pub/sub with same context IDs
- **ResponseEnvelope** -- Success/error with result or error object (code, message, retryable)

---

## Persistence

| Storage | Purpose |
|---|---|
| **SQLite** | Audit event durable storage (30-day retention) |
| **JSON files** | Settings, workspace/project metadata, recovery state machine |
| **In-memory** | Ring buffer (hot audit queries), terminal buffers, session registry, method/topic registries |

---

## CI/CD

The project uses 18 GitHub Actions workflows with an 8-stage gate pipeline:

1. Type check
2. Lint
3. Unit tests
4. E2E tests
5. Coverage (85% threshold)
6. Security scan
7. Static analysis
8. Bypass detection

Run gates locally with `bun run gates`. Reports are stored in `.gate-reports/`.
