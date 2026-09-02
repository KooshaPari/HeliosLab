# Implementation Strategy

## Locked Architecture

- Language and packaging: `TS7-native`, prerelease-first dependency policy (`beta`/`rc`)
- Shell: `ElectroBun`
- Renderer engines: `ghostty` and `rio`
- Worktree orchestrator: `par`
- Mux core: `zellij`
- Persistence/collab layer: `zmx` + `upterm` + `tmate`
- Protocols: `ACP` + `MCP` + `A2A` + internal local control bus

## Process Model

- ElectroBun host process owns lifecycle, windows, settings, and policy gates.
- `par` manages worktree lane creation, assignment, and cleanup for agent tasks.
- Renderer worker abstraction supports `ghostty` and `rio` backends.
- `zellij` session supervisor manages pane/tab topology per worktree lane.
- `zmx` tracks durable terminal process identities and restore metadata.
- `upterm` and `tmate` adapters expose explicit share sessions for selected terminals.
- Internal control bus (local IPC) coordinates session, renderer, agent, and policy events.

## Renderer Feature Flag Design

### Settings contract
- Key: `renderer_engine`
- Allowed values: `ghostty`, `rio`
- Persisted scope: workspace default with global override

### Switch flow
1. User changes renderer in settings.
2. Runtime performs capability check for target backend.
3. If hot swap supported:
- suspend output streams briefly
- remount renderer backend
- replay visible screen buffers
- resume streams
4. If hot swap unsupported:
- display restart notice
- checkpoint session state via `zmx` and `zellij`
- fast restart host
- restore sessions automatically

### Safety rules
- Never drop PTY process state during renderer switch.
- Switch operation is transactional; rollback to previous renderer on failure.

## Worktree Swarm Design (`par`)

### Lane model
- each task lane maps to:
  - one git worktree
  - one zellij session namespace
  - one or more terminals tracked by zmx

### Lane lifecycle
1. `par` creates/selects worktree for task
2. runtime creates/attaches zellij session
3. terminals are registered with zmx
4. optional share session can be attached via upterm/tmate
5. lane completion triggers cleanup policy (archive/keep/prune)

### Guardrails
- max active lanes configurable by workspace
- orphaned worktree/session detector runs periodically
- cleanup actions must emit audit records

## Layered Responsibilities

### ElectroBun shell
- Settings, feature flags, app lifecycle, menu/command registration, secure storage access.

### Renderer adapters
- Terminal draw pipeline, input handling, resize propagation, clipboard hooks, semantic markers.

### par integration
- Worktree provisioning, branch/task lane mapping, lane lifecycle hooks.

### zellij integration
- Pane/tab/session orchestration and command routing.

### zmx integration
- Durable process/session persistence and crash recovery checkpoints.

### upterm/tmate integration
- Secure, user-approved share-session creation and termination.

### Protocol runtime
- ACP: client boundary adapter where supported by agents.
- MCP: tool/resource interoperability.
- A2A: external agent federation boundary.
- internal bus: deterministic local command and event orchestration.

## Security and Policy

- Share-session actions (`upterm`/`tmate`) are deny-by-default and require explicit user approval per terminal.
- Command policy engine applies before any agent-mediated execution.
- Sensitive paths and secrets are masked in logs and share surfaces.
- Collaboration endpoints are ephemeral by default with configurable TTL.

## Performance Strategy

- Pre-allocate renderer buffers with upper bounds per terminal.
- Backpressure on high-output streams.
- Lazy rendering for inactive tabs/panes.
- Session checkpoint batching for low-overhead zmx persistence.
- Lane pooling and bounded worktree creation to avoid FS thrash.

## Delivery Plan

### Phase 1
- ElectroBun shell + par + zellij + single renderer (`ghostty`) baseline.

### Phase 2
- Add `rio` backend and feature-flag switch flow.

### Phase 3
- Integrate `zmx` durability and restart restoration.

### Phase 4
- Integrate `upterm` and `tmate` share-session workflows.

### Phase 5
- Harden protocol layer (ACP + MCP + A2A + internal bus), policy gates, and observability.

## Exit Criteria

- Dual-renderer switching works via hot swap or safe restart path.
- 25-terminal workload remains responsive.
- `par` lane lifecycle remains stable under swarm load.
- `zmx` restores sessions reliably after crash/restart.
- `upterm`/`tmate` handoff is stable and policy-controlled.
