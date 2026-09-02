# Implementation Backlog

Date: 2026-02-26
Status: Drafted for execution

## Epic 1: Runtime foundation

- HLS-001: Bootstrap ElectroBun app shell and app config loader.
- HLS-002: Implement internal local bus server/client and correlation IDs.
- HLS-003: Add workspace and project models with persistence.

## Epic 2: Worktree and mux orchestration

- HLS-010: Integrate `par` lane lifecycle wrapper (create/list/attach/cleanup).
- HLS-011: Integrate `zellij` session adapter per lane.
- HLS-012: Add lane watchdog for orphaned worktrees/sessions.

## Epic 3: Terminal lifecycle and durability

- HLS-020: Implement terminal process registry.
- HLS-021: Integrate `zmx` checkpoint/restore hooks.
- HLS-022: Crash restart recovery pipeline with session replay.

## Epic 4: Renderer subsystem

- HLS-030: Implement renderer adapter interface.
- HLS-031: Implement `ghostty` adapter.
- HLS-032: Implement `rio` adapter.
- HLS-033: Implement feature-flag switch and transactional fallback restart.

## Epic 5: Collaboration overlays

- HLS-040: Integrate `upterm` adapter with policy gate.
- HLS-041: Integrate `tmate` adapter with policy gate.
- HLS-042: Add share-session lifecycle UI and TTL defaults.

## Epic 6: Agent protocol boundaries

- HLS-050: Implement ACP client boundary adapter.
- HLS-051: Implement MCP runtime tool bridge.
- HLS-052: Implement A2A external federation adapter.

## Epic 7: Policy, audit, and safety

- HLS-060: Policy engine for command/share/agent actions.
- HLS-061: Structured audit sink and export bundle.
- HLS-062: Secrets redaction and sensitive path enforcement.

## Epic 8: Performance and reliability

- HLS-070: Memory accounting instrumentation.
- HLS-071: 25-terminal soak harness.
- HLS-072: Worktree swarm stress harness (`par` + zellij + zmx).
- HLS-073: Renderer switch reliability tests.

## Execution order

1. Epic 1
2. Epic 2
3. Epic 3
4. Epic 4
5. Epic 6
6. Epic 7
7. Epic 5
8. Epic 8

## Cross-Cutting Policy Tasks (TS7 + Beta/RC)

- HLS-900: TS7 baseline configuration across runtime and desktop packages.
- HLS-901: prerelease dependency registry with owner and rollback pin per package.
- HLS-902: canary upgrade pipeline for critical path dependencies.
- HLS-903: compatibility gate checklist for renderer, protocol, and lane/session lifecycle.
- HLS-904: exception workflow for temporary stable pin with unpin due date.
