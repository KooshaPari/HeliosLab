# Benchora Architecture

> Deep dive. Auditor-facing canonical root file: [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
> SSOT index: [`../SSOT.md`](../SSOT.md). Spec: `BENCH-002`.

## What It Is

Rust CLI tool for benchmark comparison, mutation testing, and regression detection. Part of the xDD (eXtreme Development Discipline) framework. Stores baselines in SQLite, diffs current runs against baselines, and detects regressions exceeding configurable thresholds.

## Directory Layout

```
Benchora/
├── Cargo.toml                    # Crate: phenotype_xdd_lib (lib) + benchora (bin)
├── src/
│   ├── lib.rs                    # Library root
│   ├── bin/benchora.rs           # CLI entry point
│   ├── cli/                      # CLI commands (clap)
│   │   ├── mod.rs                # Cli struct + Cmd enum + run() dispatcher
│   │   ├── run.rs                # Run benchmark suite
│   │   ├── report.rs             # Summarize saved report
│   │   ├── baseline.rs           # Promote report → named baseline
│   │   ├── compare.rs            # Diff current vs baseline
│   │   ├── mutate.rs             # Mutation testing runner
│   │   └── tracker_db.rs         # SQLite operations
│   ├── domain/                   # Pure business logic (XddError, ErrorCategory)
│   ├── mutation/                 # Mutation testing (MutationTracker, MutationKind)
│   └── spec/                     # Spec DSL (Feature → Scenario → Given/When/Then)
├── benches/                      # Criterion benchmarks
├── tests/                        # Integration tests
└── Taskfile.yml                  # Task runner
```

## Key Subcommands

| Subcommand | Description |
|---|---|
| `run` | Run a benchmark suite (`core`, `mutation`, `property`) → JSON report |
| `report` | Summarize a saved report to stdout |
| `baseline` | Promote a report to a named baseline (e.g. `nightly`, `release-1.0`) |
| `compare` | Diff current report against a stored baseline, fail if regression > threshold |
| `mutate` | Run mutation testing via `cargo-mutants`, enforce minimum score |
| `list` | List stored baselines, reports, or mutations |

## Data Flow

```
Benchmark execution (criterion / custom) → report.json
  → benchora baseline --name nightly --from report.json (store in SQLite)
  → benchora compare --baseline nightly --current new-report.json
      → per-benchmark diffs (abs + pct)
      → check against regression_threshold_pct (default 5.0%)
      → Grade: PASS / FAIL
```

## Mutation Framework

| Abstraction | Role |
|---|---|
| `MutationTracker` | Tracks line/branch coverage + mutation status per file |
| `MutationKind` | `Arithmetic`, `Comparison`, `Boolean`, `ValueReplacement`, `StatementRemoval` |
| `MutationStatus` | `Killed`, `Survived`, `Equivalent` |
| `CoverageReport` | Aggregated coverage + mutation score across files |

Flow: `cargo-mutants` introduces mutations → tests run → tracker records killed/survived → score = killed / total.

## Spec DSL (SpecDD)

Executable specifications in YAML:

```yaml
spec:
  name: User Authentication
  features:
    - id: AUTH-001
      scenario: { given: valid credentials, when: submit login, then: redirect }
  requirements:
    - id: REQ-001
      description: Password must be 8+ chars
      priority: high
      status: implemented
```

## Quick Start

```bash
cargo build --release
benchora run --suite core --out report.json
benchora baseline --name nightly --from report.json
benchora compare --baseline nightly --current new-report.json
benchora mutate --package my_crate --min-score 80
```
