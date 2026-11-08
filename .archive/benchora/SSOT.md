# SSOT — Benchora

> Single source of truth index for agents, CI soft gates, and phenotype auditors.
> Spec IDs: `BENCH-002` (governance), `BENCH-003` (config), `BENCH-005` (monitoring), `BENCH-006` (CLI API), `BENCH-007` (rescore).

## Canonical documents

| Concern | Source of truth | Notes |
|---------|-----------------|-------|
| Product contract / traces | [`SPEC.md`](./SPEC.md) | `BENCH-NNN` IDs; `@trace` markers |
| Architecture (auditor root) | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Canonical path auditors check |
| Architecture (detail) | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Full crate map + data flow |
| API surface (CLI) | [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md) | clap subcommands; soft help contract |
| Monitoring (exit + schema) | [`SPEC.md`](./SPEC.md) § Monitoring | Soft L29; no Prometheus |
| This index | [`SSOT.md`](./SSOT.md) | Doc + config pointers |
| Agent operating notes | [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md) | Branch / AgilePlus mandate |
| Contribute / quality loop | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | fmt / clippy / test / bench |
| Security reporting | [`SECURITY.md`](./SECURITY.md) | Vulnerability disclosure |
| Changelog / semver | [`CHANGELOG.md`](./CHANGELOG.md) | Keep a Changelog |
| License | [`LICENSE`](./LICENSE) | MIT |
| Audit grade (rescored) | [`audit_scorecard.json`](./audit_scorecard.json) | BENCH-007 after T1–T5; was 82→85 / B |
| Score lift plan | [`docs/SCORECARD.md`](./docs/SCORECARD.md) | WORK_DAG + rescore delta |
| Intent / boundary | [`docs/intent/Benchora.md`](./docs/intent/Benchora.md), [`docs/boundary/Benchora.md`](./docs/boundary/Benchora.md) | Registry-propagated |
| FR coverage soft gate | [`trace-gate.toml`](./trace-gate.toml) | `min_coverage`, `strict_mode = false` |
| Dependency policy | [`deny.toml`](./deny.toml) | cargo-deny |
| Toolchain pin | [`rust-toolchain.toml`](./rust-toolchain.toml) | Stable channel pin |

## Runtime configuration (no org secrets)

Canonical env table (keep in sync with [`SPEC.md`](./SPEC.md) `BENCH-003`):

| Knob | Clap flag | Default | Purpose |
|------|-----------|---------|---------|
| `BENCHORA_DB` | `--db` (global) | `benchora.db` | SQLite path for baselines + report / mutation metadata |
| `BENCHORA_REGRESSION_THRESHOLD_PCT` | `--regression-threshold-pct` | `5.0` | `compare` regression fail gate (percent) |

| Setting | Precedence (highest wins) |
|---------|---------------------------|
| DB path | `--db` → `BENCHORA_DB` → `benchora.db` |
| Regression threshold | flag → env → DB-stored value → `5.0` |

Soft contract: [`tests/config_env_contract_test.rs`](./tests/config_env_contract_test.rs)
(clap default + `BENCHORA_DB` override + help mentions env).

## Monitoring (no org metrics stack)

CLI health signal for L29 (`BENCH-005`): process **exit codes** + report JSON
schema — not Prometheus, tracing SaaS, or a `--health` HTTP endpoint.

| Code | Meaning |
|-----:|---------|
| `0` | Success (`cli::run` → `Ok`) |
| `1` | `CliError` (incl. compare regression / mutate min-score) |
| `2` | Clap usage error (before dispatch) |

Report envelope id: **`benchora.report.v1`**
(`phenotype_xdd_lib::cli::report::REPORT_SCHEMA_V1`). Required keys:
`schema`, `suite`, `created_at`, `bench_name`, `benchmarks`, `host`.

Soft contract: [`tests/monitoring_contract_test.rs`](./tests/monitoring_contract_test.rs).

## CLI help / subcommand surface (`BENCH-006`)

| Subcommand | Purpose |
|------------|---------|
| `run` | Run suite + write report |
| `report` | Summarize saved report |
| `baseline` | Promote report → named baseline |
| `compare` | Diff report vs baseline |
| `mutate` | Mutation testing via `cargo mutants` |
| `list` | List baselines / reports / mutations |

Soft contract: [`tests/cli_help_contract_test.rs`](./tests/cli_help_contract_test.rs)
(top-level `--help` lists all six; registry matches; each subcommand help non-empty).
Rustdoc: `src/cli/mod.rs` (`phenotype_xdd_lib::cli`).

Also (build/CI, not CLI product knobs):

| Knob | Default | Purpose |
|------|---------|---------|
| Criterion / `cargo bench` | crate `[[bench]]` targets | Statistical benches |
| CI `RUSTFLAGS` | `-D warnings` | Treat warnings as errors in Actions |

Secrets (API tokens, cloud creds) are **out of scope** for local bench/CLI use.
Do not commit `.env` files with credentials; `benchora.db` is local state.

## Traceability scheme

- Prefer **`BENCH-NNN`** in specs, rustdoc, and PR bodies (`CONTRIBUTING.md`).
- CI may also run the reusable phenotype **FR coverage** soft gate
  (`trace-gate.yml`); treat failures as informational unless the workflow is
  later flipped to hard-fail.

## Update rule

When adding a new top-level process doc or env knob, update **this file** in
the same PR so auditors and agents keep a single index.
