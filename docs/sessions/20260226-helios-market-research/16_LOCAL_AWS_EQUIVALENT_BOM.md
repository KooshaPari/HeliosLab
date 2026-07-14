# Local AWS-Equivalent BOM

Date: 2026-02-26
Scope: Local-first infrastructure bill of materials for Helios and related repos.

## Objective

Provide a concrete "local cloud" module set that maps to common AWS/SaaS capabilities, with adoption priority and rollout phases.

## 1) Must-Have (Phase 0-1)

- `ElectroBun`:
  - desktop shell runtime for Helios UI

- `par` + `zellij` + `zmx` + `upterm` + `tmate`:
  - worktree lanes, mux sessions, durability, and share/handoff

- `Postgres` (with extensions):
  - canonical relational system of record
  - suggested extensions: `pgvector`, time-series extension as needed

- `SQLite/libSQL`:
  - on-device edge/session state and fast local persistence

- `Temporal`:
  - durable long-running workflows, retries, approvals, resumability

- `NATS JetStream`:
  - event backbone, replay, KV/object primitives for operational state fanout

- `OpenTelemetry` + `Prometheus` + `Loki` + `Grafana`:
  - production-grade local observability and debugging

## 2) Should-Have (Phase 2)

- `Dapr`:
  - service invocation and pubsub portability across local/distributed deployment targets
  - apply at service boundaries, not PTY hot path

- `Valkey` (or `Dragonfly`):
  - Redis-compatible hot cache plane where JetStream KV is not enough

- `MinIO` or `SeaweedFS`:
  - local S3-compatible object storage for artifacts/snapshots/exports

- `Neo4j`:
  - graph plane for relationship-heavy traversal and impact analysis (if needed)

## 3) Optional (Phase 3)

- `LocalStack`:
  - local emulation for AWS API compatibility testing

- `k3s`:
  - laptop Kubernetes for microservice orchestration and production-like deployment drills

- `OpenBao`:
  - advanced secrets management parity with Vault-like workflows

- `DuckDB`:
  - local analytics acceleration for large event/audit exports

## 4) AWS/SaaS Capability Mapping

- Compute orchestration:
  - AWS ECS/EKS equivalent -> `k3s` + `Dapr` + process supervision

- Workflow orchestration:
  - AWS Step Functions equivalent -> `Temporal`

- Event bus/streaming:
  - AWS SNS/SQS/Kinesis equivalents -> `NATS JetStream`

- Key-value/cache:
  - AWS ElastiCache equivalent -> `Valkey`/`Dragonfly`

- Object storage:
  - AWS S3 equivalent -> `MinIO` or `SeaweedFS`

- Relational DB:
  - AWS RDS Postgres equivalent -> local `Postgres`

- Graph DB:
  - AWS Neptune-like graph capability -> `Neo4j`

- Secrets:
  - AWS Secrets Manager equivalent -> `OpenBao`

- Observability:
  - CloudWatch/X-Ray-like stack -> `OTel + Prometheus + Loki + Grafana (+ Tempo/Jaeger)`

## 5) Phase 0-3 Adoption Order

### Phase 0: Contract and baseline

1. Postgres + SQLite/libSQL
2. Temporal
3. NATS JetStream
4. OTel/Grafana stack

Exit:
- core local workflows run end-to-end with auditable events

### Phase 1: Runtime and swarm operations

1. par + zellij + zmx + upterm + tmate integrations fully wired
2. localbus + ACP/MCP/A2A boundaries stabilized

Exit:
- 25-terminal local swarm baseline stable

### Phase 2: Portability and service expansion

1. Dapr at selected service boundaries
2. Valkey/Dragonfly hot cache where needed
3. MinIO/SeaweedFS object storage

Exit:
- distributed-ready architecture without hot-path regressions

### Phase 3: Advanced platform parity

1. k3s-based deployment topology
2. LocalStack for AWS compatibility simulations
3. OpenBao secrets hardening
4. optional Neo4j and DuckDB if justified by workload

Exit:
- "local cloud" parity for multi-tenant MAS operations

## 6) Decision Rules

1. Do not add distributed runtime components to PTY hot path.
2. Add modules only when they close a measured gap.
3. Every new module requires:
- owner
- rollback path
- perf and operational acceptance checks

## 7) Minimal Starter Profile (recommended now)

- ElectroBun
- Postgres + SQLite/libSQL
- Temporal
- NATS JetStream
- par + zellij + zmx + upterm + tmate
- OTel/Grafana stack

Then layer Dapr and cache/object systems once real workload pressure proves need.
