# Cross-Repo Rollout Map (Phase 0-3)

Date: 2026-02-26
Scope: Align `heliosApp`, `heliosCLI`, `thegent`, `trace`, `heliosHarness` for long-running multi-tenant MAS swarms.

## Repo Ownership and Responsibilities

- `heliosApp`:
  - Desktop UX shell (ElectroBun)
  - Terminal-first runtime client
  - Renderer switching (`ghostty`/`rio`)
  - Lane/session UI orchestration and approvals

- `heliosCLI`:
  - Local developer entrypoint
  - CLI commands for runtime operations and protocol diagnostics
  - Headless/automation interfaces for local operator workflows

- `thegent`:
  - Swarm planner/router
  - Provider routing, policy gates, agent lifecycle orchestration
  - ACP/MCP/A2A adapters at agent boundary

- `trace`:
  - Durable workflow and governance substrate
  - Temporal workflows, workflow observability, evidence and audit APIs
  - Compliance and traceability views for swarm runs

- `heliosHarness`:
  - Optimization dashboard
  - Pareto and ledger visibility
  - NATS/JetStream-driven telemetry views and tuning insights

## Phase 0: Contract Freeze and Baseline (1-2 weeks)

### Goals
- Freeze protocol and event contracts across repos.
- Establish baseline integration test matrix.
- Ensure consistent IDs and correlation conventions.

### Deliverables
- `helios.localbus.v1` envelope schema and method/topic catalog.
- cross-repo ID standards:
  - `workspace_id`
  - `lane_id`
  - `session_id`
  - `terminal_id`
  - `run_id`
  - `correlation_id`

### API/Event contracts
- Contract C0-1 (`heliosApp` <-> `thegent`):
  - command API: `agent.run`, `agent.cancel`, `approval.request.resolve`
- Contract C0-2 (`thegent` <-> `trace`):
  - workflow start/status/result endpoints for durable runs
- Contract C0-3 (`thegent`/`trace` -> `heliosHarness`):
  - telemetry topics and metric schema over NATS/JetStream

## Phase 1: Local-First Runtime Integration (2-4 weeks)

### Goals
- Deliver end-to-end local flow with lane lifecycle and terminal mux.
- Keep distributed complexity behind feature toggles.

### Ownership
- `heliosApp`: lane/session UI + renderer path
- `heliosCLI`: local command surfaces
- `thegent`: lane orchestration + provider adapters

### API/Event contracts
- Contract P1-1 Lane lifecycle:
  - commands: `lane.create`, `lane.attach`, `lane.cleanup`
  - events: `lane.created`, `lane.cleaned`
- Contract P1-2 Terminal lifecycle:
  - commands: `terminal.spawn`, `terminal.input`, `terminal.resize`
  - events: `terminal.spawned`, `terminal.output`, `terminal.state.changed`
- Contract P1-3 Collaboration lifecycle:
  - commands: `share.upterm.start/stop`, `share.tmate.start/stop`
  - events: `share.session.started/stopped`

## Phase 2: Durable Multi-Tenant Workflows (3-6 weeks)

### Goals
- Make long-running swarm tasks durable and resumable via Temporal.
- Add tenant isolation and policy-aware workflow controls.

### Ownership
- `trace`: Temporal workflow definitions, workers, workflow APIs
- `thegent`: workflow intent submission and checkpoint integration
- `heliosApp`/`heliosCLI`: user-facing workflow controls and status displays

### API/Event contracts
- Contract P2-1 Workflow submission (`thegent` -> `trace`):
  - `POST /workflows/run`
  - payload: tenant, lane, task spec, policy context
- Contract P2-2 Workflow state stream (`trace` -> consumers):
  - workflow state events (`queued`, `running`, `retrying`, `awaiting_approval`, `completed`, `failed`)
  - includes `workflow_id`, `run_id`, `correlation_id`
- Contract P2-3 Checkpoint/recovery:
  - `thegent` maps Temporal checkpoints to lane/session state
  - `heliosApp` renders recovery prompt/actions

## Phase 3: Distributed Portability + Optimization Plane (4-8 weeks)

### Goals
- Add Dapr portability for service invocation/pubsub/state binding where needed.
- Expose optimization and policy health surfaces in `heliosHarness`.

### Ownership
- `thegent` + `trace`: Dapr-enabled service edges and pubsub bindings
- `heliosHarness`: metrics aggregation and Pareto/ledger optimization UI
- `heliosApp`/`heliosCLI`: operator controls and surfaced diagnostics

### API/Event contracts
- Contract P3-1 Service invocation:
  - typed service endpoints for workflow and policy operations
  - Dapr sidecar invocation where portability is needed
- Contract P3-2 Event backbone:
  - NATS/JetStream canonical topics remain source for telemetry fanout
  - Dapr pubsub bridge optional where deployment model requires it
- Contract P3-3 Optimization loop:
  - `heliosHarness` consumes run telemetry, cost, latency, success metrics
  - emits recommended routing/policy adjustments back to `thegent`

## Canonical Event Topics (Cross-Repo)

- `helios.lane.created`
- `helios.lane.cleaned`
- `helios.session.attached`
- `helios.terminal.output`
- `helios.agent.run.started`
- `helios.agent.run.progress`
- `helios.agent.run.completed`
- `helios.agent.run.failed`
- `helios.approval.requested`
- `helios.approval.resolved`
- `helios.workflow.state.changed`
- `helios.audit.recorded`
- `helios.policy.denied`

## API Surface (Minimum)

- `thegent` APIs:
  - `POST /api/v1/lane/create`
  - `POST /api/v1/lane/cleanup`
  - `POST /api/v1/agent/run`
  - `POST /api/v1/agent/cancel`

- `trace` APIs:
  - `POST /api/v1/workflows/run`
  - `GET /api/v1/workflows/{id}`
  - `GET /api/v1/workflows/{id}/events`
  - `GET /api/v1/temporal/summary`

- `heliosHarness` APIs:
  - `GET /api/v1/metrics/pareto`
  - `GET /api/v1/metrics/ledger`
  - `POST /api/v1/recommendations/apply`

## Non-Negotiable Rules

1. Local PTY hot path remains independent from distributed orchestration stack.
2. All cross-repo operations include `correlation_id` and `tenant_id`.
3. Policy checks execute before remote workflow dispatch.
4. Any cross-repo failure must degrade gracefully to lane-level failure, not global runtime crash.

## Exit Criteria by Phase

- Phase 0:
  - contract docs frozen and reviewed across repo owners
- Phase 1:
  - local lane/session flow stable with 25 terminals
- Phase 2:
  - durable workflow resume/retry/human-approval loops working via Temporal
- Phase 3:
  - Dapr portability path and optimization feedback loop operational
