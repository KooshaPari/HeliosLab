# HeliosApp Specification

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      Desktop Shell (ElectroBun)               │
│  tabs, panels, settings, context store, EditorlessCtrlPlane   │
└─────────────────────────┬─────────────────────────────────────┘
                          │ LocalBus V1 (26 methods, 40 topics)
┌─────────────────────────▼─────────────────────────────────────┐
│                     Runtime Engine                             │
│ ┌──────────┐ ┌─────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ Sessions │ │ PTY │ │ Providers│ │ Recovery │ │  Audit   │ │
│ └──────────┘ └─────┘ └──────────┘ └──────────┘ └──────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│ │ Secrets  │ │  Policy  │ │ Registry │ │  Integrations    │  │
│ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
└─────────────────────────┬─────────────────────────────────────┘
                          │ HTTP API (Bun fetch handler)
┌─────────────────────────▼─────────────────────────────────────┐
│                    Web Renderer (SolidJS)                      │
│  terminal (xterm.js), chat panel, sidebar, status bar         │
└───────────────────────────────────────────────────────────────┘
```

## Monorepo Layout

```
apps/
  runtime/        Core engine: bus, PTY, sessions, providers, audit, recovery
  desktop/        Desktop shell: tabs, panels, settings, context store
  renderer/       SolidJS standalone web renderer
  colab-renderer  Collaborative multi-user renderer
packages/
  runtime-core    Shared types, API client, config helpers, ID utilities
  ids             ULID-based ID generation (ws_, ln_, ss_, tm_, cor_ prefixes)
  errors          Error type definitions
  logger          Pino-based structured logging
  types           Base TypeScript type definitions
```

## Core Data Models

| Entity       | Key Fields                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| Workspace    | id, name, rootPath, state (active/closed/deleted)                          |
| Lane         | id, workspaceId, state (creating/active/closed/failed)                     |
| Session      | id, laneId, terminalId, workspaceId, state (active/detached/terminated)    |
| Terminal     | id, sessionId, state (spawning/running/throttled/closed)                   |
| Conversation | id, title, messages[], modelId, createdAt, updatedAt                       |
| Message      | id, role (user/assistant/system/tool_call/tool_result), content, timestamp |

## Protocol Envelopes

- CommandEnvelope: method-based dispatch with workspace/lane/session/terminal context
- EventEnvelope: topic-based pub/sub with same context IDs
- ResponseEnvelope: success/error with result or error object (code, message, retryable)

## State Machines

| Entity   | States                                                              |
| -------- | ------------------------------------------------------------------- |
| Lane     | idle, creating, active, paused, cleanup, closed, failed, terminated |
| Session  | created, attaching, attached, detaching, detached, terminated       |
| PTY      | idle, spawning, active, throttled, errored, stopped                 |
| Renderer | 7 states with red-black transaction rollback                        |
| Recovery | 6 states with safe mode for crash loops (3+ crashes in 60s)         |

## HTTP API

| Method | Path                                         | Description                              |
| ------ | -------------------------------------------- | ---------------------------------------- |
| POST   | /v1/protocol/dispatch                        | Dispatch commands via BoundaryDispatcher |
| POST   | /v1/workspaces/{id}/lanes                    | Create a new lane                        |
| POST   | /v1/workspaces/{id}/lanes/{laneId}/sessions  | Attach/create session                    |
| POST   | /v1/workspaces/{id}/lanes/{laneId}/terminals | Spawn a terminal                         |
| POST   | /v1/workspaces/{id}/lanes/{laneId}/cleanup   | Cleanup lane and resources               |
| GET    | /v1/harness/cliproxy/status                  | Check cliproxy harness availability      |

## LocalBus Methods (26)

Workspace: workspace.create, workspace.open, project.clone, project.init
Session: session.create, session.attach, session.terminate, terminal.spawn, terminal.resize, terminal.input
Lane: lane.create, lane.attach, lane.cleanup
Renderer: renderer.switch, renderer.capabilities
Agent: agent.run, agent.cancel
Sharing: share.upterm.start, share.upterm.stop, share.tmate.start, share.tmate.stop
Zellij: zmx.checkpoint, zmx.restore
Policy: approval.request.resolve
Boundary: boundary.local.dispatch, boundary.tool.dispatch, boundary.a2a.dispatch

## Provider Adapters

| Provider  | Backend                   |
| --------- | ------------------------- |
| Anthropic | Primary cloud inference   |
| MLX       | Apple Silicon local       |
| llama.cpp | Local GPU inference       |
| vLLM      | NVIDIA GPU serving        |
| ACP       | Anthropic client protocol |
| A2A       | Agent-to-agent federation |

## Persistence

| Store      | Purpose                                         |
| ---------- | ----------------------------------------------- |
| SQLite     | Audit events (30-day retention), session replay |
| JSON files | Settings, workspace metadata, recovery state    |
| In-memory  | Ring buffer, terminal buffers, session registry |

## Performance Targets

| Metric                     | Target      |
| -------------------------- | ----------- |
| LocalBus dispatch latency  | < 5ms p95   |
| PTY spawn time             | < 200ms     |
| Session attach             | < 100ms     |
| Audit write                | < 10ms p99  |
| Renderer switch (rollback) | < 500ms     |
| Gate pipeline (full)       | < 10 min CI |
| Test coverage threshold    | 85% minimum |

## Quality Gates (CI)

1. Type check (tsc --noEmit)
2. Lint (Biome + oxlint)
3. Unit tests (Bun test runner)
4. E2E tests (Playwright)
5. Coverage (85% threshold)
6. Security scan
7. Static analysis
8. Bypass detection

## Technology Stack

| Layer              | Technology                                    |
| ------------------ | --------------------------------------------- |
| Runtime            | Bun 1.2.20+ (ESM)                             |
| Language           | TypeScript 7.x (strict, verbatimModuleSyntax) |
| UI                 | SolidJS 1.9.x                                 |
| Terminal           | xterm.js 6.x                                  |
| HTTP Client        | ky 1.14.3                                     |
| Logging            | pino 10.x                                     |
| Build              | esbuild 0.27.x                                |
| Testing            | Bun test, Playwright 1.58                     |
| Linting            | Biome 2.4.9                                   |
| Task Orchestration | Turborepo, go-task, just                      |
