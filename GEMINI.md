# GEMINI.md

This file provides guidance to Google Gemini when working with code in this repository.

## Project Overview

HeliosApp is a developer-focused AI runtime environment with a desktop shell, terminal multiplexing, session management, and multi-provider AI inference. It is structured as a Bun monorepo containing four applications and five shared packages.

**Version:** 2026.03A.0  
**Package Manager:** Bun 1.2.20+  
**Runtime:** TypeScript 7.x (strict mode)

## Kilo Gastown Identity

- **Rig ID:** `35903ad7-65d2-489a-bf30-ff95018fd80f`
- **Town ID:** `78a8d430-a206-4a25-96c0-5cd9f5caf984`
- **Convoy:** `convoy/methodology-heliosapp/8fb6d6ea`

## Kilo Delegation Tools

Agents in this rig can delegate work using:

- **`gt_sling`** - Delegate a single bead/task to another agent
- **`gt_sling_batch`** - Delegate multiple beads/tasks in a single operation
- **`gt_list_convoys`** - List active convoys and their status
- **`gt_convoy_status`** - Get detailed status of a specific convoy

### Architecture

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
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP API (Bun fetch handler)
┌──────────────────────────▼──────────────────────────────────────┐
│                       Web Renderer                              │
│  (SolidJS SPA: terminal, chat, sidebar, status bar)             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

- **Event-Driven LocalBus** -- Central in-process message bus with 26 registered methods and 40 topics
- **State Machines** -- Every lifecycle-critical entity uses explicit state machines: Lane (8 states), Session (6 states), PTY (6 states), Renderer (7 states)
- **Adapter/Plugin Pattern** -- Pluggable providers for AI inference, terminal multiplexers, session sharing, renderer backends
- **Red-Black Transactions** -- Atomic renderer switching with automatic rollback on failure

## Development Commands

```bash
# Install dependencies
bun install --frozen-lockfile

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

Both `task` (go-task) and `just` are supported:

```bash
# Quick quality checks
task quality:quick    # or: just quality-quick

# Strict quality checks
task quality:strict   # or: just quality-strict

# Full preflight
task preflight        # or: just preflight
```

## Stack Info

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
| AI Providers | Anthropic (primary), MLX (Apple Silicon), llama.cpp/vLLM (NVIDIA GPU) |

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
├── docs/                  # VitePress documentation site
├── specs/                 # Protocol specifications (envelope schema, methods, topics)
├── scripts/               # Build scripts, dependency management
└── tools/                 # Gate testing fixtures and tools
```

## Code Conventions

### TypeScript

- Strict mode enabled; verbatimModuleSyntax required
- Use explicit types; avoid `any`
- Named exports preferred over default exports for packages

### State Machines

Every lifecycle-critical entity follows a strict state machine pattern. When modifying:

- **Lane**: 8 states (idle, creating, active, paused, cleanup, closed, failed, terminated)
- **Session**: 6 states (created, attaching, attached, detaching, detached, terminated)
- **PTY**: 6 states (idle, spawning, active, throttled, errored, stopped)
- **Renderer**: 7 states

### LocalBus Protocol

The message bus uses typed envelopes:

- **CommandEnvelope** -- Method-based dispatch with workspace/lane/session/terminal context
- **EventEnvelope** -- Topic-based pub/sub with same context IDs
- **ResponseEnvelope** -- Success/error with result or error object (code, message, retryable)

### File Organization

- Protocol definitions: `apps/runtime/src/protocol/`
- Business logic modules co-located with their tests
- Shared types in `packages/*/src/`

## Agent Behavior Rules

### Pre-Change Verification

1. Run `bun run typecheck` before committing
2. Run `bun run lint` and address all warnings
3. Run `bun run test` to ensure unit tests pass
4. For multi-file changes, run `bun run gates` before submitting

### Change Scope

- Keep edits constrained to the smallest needed file set
- If changing a protocol envelope or method signature, check all consumers first
- State machine transitions must be atomic and emit appropriate events

### Child Agent Usage

Use child agents for discovery/verification waves when feasible:

- Prefer scoped child-agent lanes for parallel file discovery and verification
- Keep parent-agent changes focused on integration and finalization
- Sync updates to workflow artifacts when behavior changes

### Special Handling

- **PTY changes**: PTY lifecycle is complex (SIGTERM/SIGKILL/SIGWINCH/SIGHUP signals); verify with integration tests
- **Provider changes**: Test with mock provider before using real API keys
- **LocalBus changes**: 26 methods and 40 topics; validate envelope round-trip with correct correlation IDs
- **Renderer switching**: Uses red-black transaction pattern; test both success and rollback paths

### Git Workflow

- Commit frequently on feature branches
- Push after every commit (ephemeral container)
- Use descriptive commit messages referencing the feature or work package
