# Specifications

## Product Definition

HeliosApp is a terminal-first desktop IDE focused on high-concurrency terminal workloads with integrated AI execution control.

## Product Lock (This Track)

- Language strategy: `TS7-native` wherever possible
- Package strategy: latest `beta`/`rc` channels by default with explicit rollback pins
- Desktop shell: `ElectroBun`
- Renderers: `ghostty` and `rio` both supported behind feature flag
- Worktree/task orchestrator: `par` required
- Mux core: `zellij`
- Session durability and collaboration: `zmx` + `upterm` + `tmate` required (not optional)
- Protocol stack: `ACP` (Agent Client Protocol) + `MCP` + `A2A` + internal local control bus

## Renderer Switching Requirement

- Settings must expose `renderer_engine` with values: `ghostty` or `rio`.
- On settings change, app attempts hot renderer swap.
- If hot swap is unsupported or unsafe, app must request and perform fast session-preserving restart.

## PRD

### Product Objective
Ship a desktop app that feels as polished as modern GUI tools but preserves terminal-native speed and low overhead under heavy concurrency.

### Success Metrics (v1)
- Support 25 concurrent terminals across tabs/projects with no hard UI lockups.
- Maintain median command input-to-render latency under 60 ms on target hardware.
- Keep steady-state memory under 500 MB for typical workload profile.
- Achieve >80% user-reported trust in command explainability and rollback controls.

### In Scope
- Multi-project workspace model.
- Terminal mux interface with split panes/tabs/session restore.
- New project action: init local repo or clone remote repo to configurable path.
- New chat action: choose provider/client profile.
- Freehand terminal always available (raw terminal mode).
- AI task mode with approval policies, diff previews, and rollback.
- Session/audit logs per workspace.
- Integrated share/handoff mode via `upterm` and `tmate`.
- Worktree swarm task routing via `par`.

### Out of Scope (v1)
- Full visual code editor parity with VS Code.
- Cloud multi-tenant control plane.
- Full enterprise IAM suite.

## Functional Requirements (FR)

- FR-1 Workspace creation/open/close with persistent metadata.
- FR-2 Project bootstrap from local path, git init, or git clone.
- FR-3 Terminal session manager supports >=25 live sessions.
- FR-4 Multiplexing UI supports tabs, splits, detached/re-attachable sessions.
- FR-5 AI provider profile selector at chat/session creation.
- FR-6 Freehand terminal mode can run without AI mediation.
- FR-7 AI mode supports plan/apply/approval workflow.
- FR-8 Command policy layer (allowlist/denylist + sensitive path protection).
- FR-9 Session replay and searchable audit logs.
- FR-10 Crash recovery restores project and terminal state.
- FR-11 Renderer engine feature flag and safe runtime swap/restart behavior.
- FR-12 Shared session handoff flow using `upterm` and `tmate` from active terminals.
- FR-13 `zmx` lifecycle integration for durable terminal process persistence.
- FR-14 `par` integration to create/manage agent lanes as worktree-backed tasks.
- FR-15 ACP-compatible client runtime boundary for agent orchestration adapters.

## Non-Functional Requirements (NFR)

- NFR-1 Memory budget target under 500 MB typical.
- NFR-2 App startup to interactive state under 2 seconds on reference machine.
- NFR-3 No command execution without explicit policy path.
- NFR-4 Provider isolation prevents credential/session cross-leakage.
- NFR-5 UI remains responsive under high terminal output throughput.
- NFR-6 Renderer switch operation must complete within 3 seconds (hot swap) or 8 seconds (restart path).

## User Stories

- US-1 As a platform engineer, I can open 20+ terminals across 3 repos and keep them responsive.
- US-2 As a backend developer, I can start a new repo from a URL and immediately run tasks in AI or freehand mode.
- US-3 As a security lead, I can enforce blocked commands and protected paths globally.
- US-4 As a power user, I can switch model clients without rebuilding my workspace.
- US-5 As a team lead, I can inspect audit logs for what command ran, why, and what changed.
- US-6 As an operator, I can switch between `ghostty` and `rio` from settings and continue working with minimal interruption.
- US-7 As an on-call engineer, I can share active terminal context through `upterm` or `tmate` without losing session continuity.
- US-8 As a swarm operator, I can dispatch tasks into dedicated worktrees via `par` and attach to each lane quickly.

## ADRs

### ADR-001: Desktop Runtime
Decision: Use `ElectroBun` as the desktop shell.
Rationale: Maximum innovation and runtime performance experimentation is explicitly prioritized over maturity risk.

### ADR-002: Terminal Engine
Decision: Implement dual-engine rendering (`ghostty` and `rio`) with feature flag and runtime switch semantics.
Rationale: Preserve both high-confidence and high-upside renderer tracks while keeping one product surface.

### ADR-003: Worktree and Mux Backend
Decision: Use `par` for worktree/task orchestration and `zellij` as mux core.
Rationale: Worktree-aware swarm execution is a first-class requirement and should be separate from pane/tab runtime.

### ADR-004: Session Durability and Handoff
Decision: Require `zmx`, `upterm`, and `tmate` integrations.
Rationale: Persistent agent sessions and human handoff are mandatory operational requirements.

### ADR-005: AI and Interop Protocols
Decision: Use ACP at client boundary, MCP for tools, A2A for external federation, and internal local control bus for deterministic runtime orchestration.
Rationale: Separation of concerns keeps local performance deterministic while preserving interop.

## ARUs

### Assumptions
- Dual-renderer model can be maintained without unacceptable engineering drag.
- `ElectroBun` provides sufficient native control and stability for v1 targets.

### Risks
- Dual renderer support doubles compatibility testing surface.
- Cross-platform differences in renderer integration may impact hot-swap behavior.
- Collaboration layers can increase attack surface if not tightly gated.
- Worktree churn can create filesystem and cleanup complexity under high swarm volume.

### Uncertainties
- Final API stability velocity of `ElectroBun` and `rio` on required platform matrix.
- Operational limits under sustained 25-terminal + share-session concurrency.
