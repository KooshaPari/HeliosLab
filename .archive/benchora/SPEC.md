# Benchora

Phenotype ecosystem component — Rust benchmarking + xDD toolkit
(library `phenotype_xdd_lib`, CLI `benchora`).

## Traceability

| ID | Requirement |
|----|-------------|
| BENCH-001 | Core product contract: Criterion benches, xDD utilities, CLI run/report/baseline/compare |
| BENCH-002 | Governance surface: canonical ARCHITECTURE + SSOT index + scorecard WORK_DAG |
| BENCH-003 | Config surface: documented env/clap knobs + soft contract test for `BENCHORA_DB` defaults |
| BENCH-005 | Monitoring soft evidence: CLI exit codes + `benchora.report.v1` schema (no Prometheus) |
| BENCH-006 | CLI API surface: `benchora --help` subcommand contract + rustdoc / `docs/API_REFERENCE.md` |
| BENCH-007 | Governance re-score: evidence lifts in `audit_scorecard.json` + `docs/SCORECARD.md` after T1–T5 |

```text
/// @trace BENCH-001
/// @trace BENCH-002
/// @trace BENCH-003
/// @trace BENCH-005
/// @trace BENCH-006
/// @trace BENCH-007
```

## Runtime configuration (env / clap)

Public knobs only — no org secrets. Soft evidence: `tests/config_env_contract_test.rs`.

| Knob | Clap flag | Default | Purpose |
|------|-----------|---------|---------|
| `BENCHORA_DB` | `--db` (global) | `benchora.db` | SQLite path for baselines + report / mutation metadata |
| `BENCHORA_REGRESSION_THRESHOLD_PCT` | `--regression-threshold-pct` | `5.0` | `compare` regression fail gate (percent) |

### Precedence

| Setting | Order (highest wins) |
|---------|----------------------|
| DB path | `--db` → `BENCHORA_DB` → default `benchora.db` |
| Regression threshold | `--regression-threshold-pct` → `BENCHORA_REGRESSION_THRESHOLD_PCT` → value stored in DB → `5.0` |

When adding a knob, update this table, [`SSOT.md`](./SSOT.md), and the contract test in the same PR.

## Monitoring (exit codes + report schema)

Soft evidence for L29 — no Prometheus / org metrics stack / `--health` HTTP.
CI and agents treat process exit + report JSON as the health signal.
Contract test: `tests/monitoring_contract_test.rs`.

### Exit codes

| Code | When |
|-----:|------|
| `0` | `cli::run` returned `Ok` (success) |
| `1` | Any `CliError` (I/O, DB, JSON, unknown suite, `compare` regression gate, `mutate --min-score` fail, …) |
| `2` | Clap usage / parse failure (unknown subcommand, bad flags) before `cli::run` |

Binary: `src/bin/benchora.rs` maps `Err` → `std::process::exit(1)`.

### Report schema `benchora.report.v1`

Written by `benchora run`. Constant: `phenotype_xdd_lib::cli::report::REPORT_SCHEMA_V1`.

| Field | Type | Notes |
|-------|------|-------|
| `schema` | string | Always `benchora.report.v1` |
| `suite` | string | Suite name (`core`, `mutation`, …) |
| `created_at` | string | ISO-8601 timestamp |
| `bench_name` | string | Criterion bench target name |
| `benchmarks` | array | Criterion bencher JSON objects |
| `host` | object | `{ target, cpus }` |
| `note` | string \| null | Optional diagnostic |

## CLI API surface (`BENCH-006`)

Public product API is the clap CLI (no HTTP/OpenAPI). Soft evidence:
[`tests/cli_help_contract_test.rs`](./tests/cli_help_contract_test.rs) asserts
top-level help / registry list `run`, `report`, `baseline`, `compare`,
`mutate`, `list`. Human index: [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md).
Rustdoc: `phenotype_xdd_lib::cli`.

When adding a subcommand, update API_REFERENCE, `src/cli/mod.rs` rustdoc, and
the help contract in the same PR.

## Sources of truth

See [`SSOT.md`](./SSOT.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Scorecard / WORK_DAG: [`docs/SCORECARD.md`](./docs/SCORECARD.md) (`BENCH-007` rescore).
