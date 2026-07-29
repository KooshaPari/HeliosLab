# Architecture Diagrams

Date: 2026-02-26
Scope: Consolidated architecture diagrams for Helios stack.

## Legend

- `UI`: user-facing desktop surfaces
- `RT`: local runtime daemon
- `CP`: control plane
- `DP`: data plane
- `EXT`: external/federated service boundary
- `DUR`: durable workflow/storage systems

## Naming Conventions

- IDs
  - `workspace_id`
  - `lane_id`
  - `session_id`
  - `terminal_id`
  - `run_id`
  - `tenant_id`
  - `correlation_id`

- Event topics (canonical prefix)
  - `helios.*`

- Protocol namespaces
  - local bus: `helios.localbus.v1`
  - AG-UI adapter: `helios.agui.v1`

## 1. System Overview

```text
+-----------------------------------------------------------------------------------+
|                                   Helios Desktop                                  |
|                             (ElectroBun shell, TS7)                              |
|-----------------------------------------------------------------------------------|
|  UI Layer                                                                         |
|  +----------------------+  +----------------------+  +--------------------------+ |
|  | Agent Chat Pane      |  | Terminal Canvas      |  | Context Rail            | |
|  | approvals, diffs     |  | ghostty/rio adapter  |  | lanes, audit, sharing   | |
|  +----------+-----------+  +-----------+----------+  +-------------+------------+ |
|             |                          |                               |           |
+-------------|--------------------------|-------------------------------|-----------+
              |                          |                               |
              v                          v                               v
+-----------------------------------------------------------------------------------+
|                            Local Runtime Daemon (TS7)                             |
|-----------------------------------------------------------------------------------|
|  Internal Bus: helios.localbus.v1 (authoritative state/events)                   |
|  +------------------+  +------------------+  +------------------+                 |
|  | Lane Orchestrator|  | Session Manager  |  | Policy/Audit     |                 |
|  | par integration  |  | zellij + zmx     |  | approvals, logs  |                 |
|  +--------+---------+  +--------+---------+  +--------+---------+                 |
|           |                     |                     |                            |
|           +----------+----------+----------+----------+                            |
|                      |                     |                                       |
|                      v                     v                                       |
|              +---------------+    +----------------+                               |
|              | ACP Adapter   |    | MCP Adapter    |                               |
|              +-------+-------+    +--------+-------+                               |
|                      |                     |                                       |
|                      v                     v                                       |
|              +---------------+     +----------------+                              |
|              | A2A Adapter   |     | Tool Servers   |                              |
|              +-------+-------+     +----------------+                              |
+----------------------|------------------------------------------------------------+
                       |
                       v
+-----------------------------------------------------------------------------------+
|                          Durable / Distributed Substrate                           |
|-----------------------------------------------------------------------------------|
| Temporal (durable workflows) | Dapr (service portability) | NATS/JetStream       |
+-----------------------------------------------------------------------------------+
```

## 2. Control Plane vs Data Plane

```text
DATA PLANE (latency-critical)
User key -> UI input -> PTY write -> PTY output -> renderer worker -> GPU paint

CONTROL PLANE (orchestration)
UI action -> localbus command -> runtime service -> adapters/protocols -> events -> UI updates
```

## 3. Protocol Boundary Diagram

```text
[Helios UI/Client]
      |
      | ACP (client <-> agent boundary)
      v
[Runtime Agent Boundary]
      |
      | MCP (tools/resources)
      v
[Tool/Model Servers]

[Runtime Agent Boundary] -- A2A --> [External Agents/Federation]

[Everything internal] -- localbus --> [authoritative app state/events]
```

## 4. Renderer Switch Flow

```text
User changes renderer setting
        |
        v
Capability Check
   | hot-swap supported? -------------------- no ------------------------+
   | yes                                                              Restart Path
   v                                                                   |
Freeze paint queue                                                     |
Rebind renderer adapter                                                |
Replay visible buffers                                                 |
Resume streams                                                         |
   |                                                                   |
   +-------------------------- success ---------------------------------+
                               |
                               v
                        renderer.switch.succeeded
```

## 5. Primary UI Journey

```text
[Launch App]
    |
    v
[Open Workspace] --> [Select/Clone Project]
    |
    v
[Create Lane via par]
    |
    v
[Attach Session (zellij + zmx)]
    |
    v
[Run Task: chat request]
    |
    +--> [Approval Required?] --yes--> [Review diff/policy] -> [Approve/Deny]
    |                                      | approve
    |                                      v
    |                                 [Execute]
    |                                      |
    +--------------------------------------+
    |
    v
[Observe terminal output + audit timeline]
    |
    +--> [Share session?] --yes--> [Start upterm/tmate] -> [Handoff] -> [Revoke]
    |
    v
[Checkpoint / Close lane / Cleanup]
```

## 6. Multi-Tenant Swarm Runtime

```text
Tenant A
  Lane A1 -> Worktree A1 -> zellij session A1 -> terminals A1.*
  Lane A2 -> Worktree A2 -> zellij session A2 -> terminals A2.*

Tenant B
  Lane B1 -> Worktree B1 -> zellij session B1 -> terminals B1.*

All lanes emit:
lane.* / session.* / terminal.* / agent.* / approval.* / audit.*
             -> NATS/JetStream (telemetry fanout)
             -> Temporal (durable workflow state)
             -> Harness dashboards (pareto/ledger/health)
```

## 7. Lane/Session/Terminal State Diagram

```text
Lane: new -> provisioning -> ready -> running -> shared -> running -> cleaning -> closed
                      \-> failed

Session: detached -> attaching -> attached -> restoring -> attached -> terminated

Terminal: idle -> spawning -> active -> throttled -> active
                               \-> errored -> stopped
```

## 8. Deployment Topology (Laptop-first)

```text
+---------------- Laptop Host ----------------+
| Helios Desktop (ElectroBun)                 |
| Runtime Daemon (TS7)                        |
| par, zellij, zmx, upterm, tmate binaries    |
| Temporal dev/prod profile                   |
| Dapr sidecars (selected services)           |
| NATS/JetStream                              |
| Local DB/log stores                         |
+---------------------------------------------+
```
