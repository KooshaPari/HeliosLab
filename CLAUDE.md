# CLAUDE.md — HeliosApp

## Project Overview

**HeliosApp** is a developer-focused AI runtime environment with a desktop shell, terminal multiplexing, session management, and multi-provider AI inference.

- **Version:** 2026.03A.0
- **Package Manager:** Bun 1.2.20+
- **Runtime:** TypeScript 7.x (strict mode)
- **Architecture:** Event-driven monorepo with LocalBus V1 message bus

## Stack Information

| Layer | Technology |
|-------|------------|
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

## Repository Structure

```
heliosApp/
├── apps/
│   ├── runtime/           # Core runtime engine (bus, PTY, sessions, providers, audit, recovery)
│   ├── desktop/          # Desktop shell (tabs, panels, settings, context store)
│   ├── renderer/         # Standalone SolidJS web renderer (terminal + chat UI)
│   └── colab-renderer/   # Collaborative SolidJS renderer (multi-user)
├── packages/
│   ├── runtime-core/     # Shared types, API client, config helpers, ID utilities
│   ├── ids/              # ULID-based ID generation (ws_, ln_, ss_, tm_, cor_ prefixes)
│   ├── errors/           # Error type definitions
│   ├── logger/           # Pino-based structured logging
│   └── types/            # Base TypeScript type definitions
├── docs/                  # VitePress documentation site (multi-language)
├── specs/                 # Protocol specifications (envelope schema, methods, topics)
├── scripts/               # Build scripts, dependency management, governance tools
└── tools/                 # Gate testing fixtures and tools
```

## Build Commands

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

## Key Architectural Patterns

- **Event-Driven LocalBus** — Central in-process message bus with 26 registered methods and 40 topics
- **State Machines** — Every lifecycle-critical entity uses explicit state machines (Lane: 8 states, Session: 6 states, PTY: 6 states)
- **Adapter/Plugin Pattern** — Pluggable providers for AI inference, terminal multiplexers, session sharing
- **Red-Black Transactions** — Atomic renderer switching with automatic rollback on failure
- **Append-Only Audit Log** — SQLite-backed durable event storage

## Code Conventions

### TypeScript Style
- TypeScript 7.x strict mode with `verbatimModuleSyntax`
- Explicit return types on public APIs
- No `any` types — use `unknown` and type guards
- Interface-first for data shapes

### File Organization
- One major concept per file
- Barrel exports (`index.ts`) for packages
- Co-locate tests with source (`*.test.ts`)

### Error Handling
- Use typed errors from `@helios/errors`
- Never swallow errors — always propagate or handle explicitly
- Log errors with context before throwing

### State Machines
- All lifecycle-critical entities MUST have explicit state machines
- States must be exhaustive enums, not string literals
- Transitions must be validated before mutation

## Agent Behavior Rules

### Agents MUST
- Run `bun run typecheck` and `bun run lint` before committing
- Run `bun run test` for any changes to runtime logic
- Add tests for new public API surfaces
- Update docs in `docs/` for user-facing changes
- Use typed IDs from `@helios/ids` (ws_, ln_, ss_, tm_, cor_ prefixes)
- Follow existing patterns — check `specs/` before adding new protocol methods/topics

### Agents MUST NOT
- Handroll what a library already solves — use pino for logging, ky for HTTP, etc.
- Bypass the LocalBus for inter-component communication
- Add stateful global variables — use the config/registry pattern
- Skip gates — `bun run gates` must pass before merge
- Modify `specs/` protocol definitions without consensus

### LocalBus Protocol
- 26 methods registered in `protocol/methods.ts`
- 40 topics registered in `protocol/topics.ts`
- All envelopes are typed (Command, Event, Response)
- Correlation tracking via sequence numbers

### Testing Requirements
- Unit tests for all runtime-core public APIs
- Integration tests for LocalBus method invocations
- E2E tests for user workflows (Playwright)
- 85% coverage threshold enforced in gates
