<!-- AI-DD-META:START -->
<!-- This repository is planned, maintained, and managed by AI Agents only. -->
<!-- Slop issues are expected and intentionally present as part of an HITL-less -->
<!-- /minimized AI-DD metaproject of learning, refining, and building brute-force -->
<!-- training for both agents and the human operator. -->
![Downloads](https://img.shields.io/github/downloads/<REDACTED>/Benchora/total?style=flat-square&label=downloads&color=blue) [![AI slop inside](https://sladge.net/badge.svg)](https://sladge.net)
![GitHub release](https://img.shields.io/github/v/release/<REDACTED>/Benchora?style=flat-square&label=release)
![License](https://img.shields.io/github/license/<REDACTED>/Benchora?style=flat-square)
![AI-Slop](https://img.shields.io/badge/AI--DD-Slop%20Expected-orange?style=flat-square)
![AI-Only-Maintained](https://img.shields.io/badge/Planned%20%26%20Maintained%20by-AI%20Agents%20Only-red?style=flat-square)
![HITL-less](https://img.shields.io/badge/HITL--less%20AI--DD-metaproject-yellow?style=flat-square)

> ⚠️ **AI-Agent-Only Repository**
>
> This repo is **planned, maintained, and managed exclusively by AI Agents**.
> Slop issues, rough edges, and AI artifacts are **expected and intentionally
> present** as part of an **HITL-less / minimized AI-DD** metaproject focused
> on learning, refining, and brute-force training both the agents and the
> human operator. Bug reports and contributions are still welcome, but please
> expect AI-generated code, comments, and documentation throughout.
<!-- AI-DD-META:END -->

## Work State

| Field | Value |
|---|---|
| Status | ACTIVE (repo unarchived) |
| Crate version | `0.2.0` — tagged [`v0.2.0`](https://github.com/KooshaPari/Benchora/releases/tag/v0.2.0) |
| crates.io | **Published** — [`benchora` 0.2.0](https://crates.io/crates/benchora) |
| Install path | crates.io preferred — see [Install](#install) |
| Scorecard | ~85 / B (`audit_scorecard.json`, `BENCH-007`) |
| Focus | Post-0.2.0 hardening; keep CI green |

Progress: `██████████` ~100% for first crates.io release.

> First release complete: git tag `v0.2.0`, GitHub Release, and `cargo publish`.

[![CI](https://github.com/KooshaPari/Benchora/actions/workflows/ci.yml/badge.svg)](https://github.com/KooshaPari/Benchora/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

# Benchora

Rust benchmarking and xDD testing toolkit for the Phenotype ecosystem — Criterion
harnesses, a `benchora` CLI, SQLite-backed baselines, mutation-coverage tracking,
and reusable xDD utilities.

## Install

Preferred (crates.io):

```bash
cargo install benchora --locked
```

From a clone (dev / unreleased `main`):

```bash
cargo install --path . --locked
```

Or from GitHub without cloning first:

```bash
cargo install --git https://github.com/KooshaPari/Benchora --locked
```

Requires a recent Rust stable toolchain (`rustfmt` + `clippy`; see `rust-toolchain.toml`).
MSRV intent: 1.75+.

After install, the `benchora` binary is on your `PATH`.

### Docker (local smoke; no registry)

Multi-stage image builds the release CLI. No login or push — no registry secrets:

```bash
make docker-smoke
# equivalent:
# docker build -t benchora:local .
# docker run --rm benchora:local --help
```

Soft CI job `docker-smoke` runs the same local build+`--help` check (`continue-on-error`).

## Quick Start

```bash
git clone https://github.com/KooshaPari/Benchora
cd Benchora
cargo build --locked
cargo test --locked

# Criterion benches
cargo bench --bench my_benchmark
cargo bench --bench phenotype_xdd_lib_bench

# CLI (from build tree)
cargo run --release --locked --bin benchora -- run --suite my_benchmark --out ./reports
cargo run --release --locked --bin benchora -- baseline --from ./reports/my_benchmark-*.json nightly
cargo run --release --locked --bin benchora -- compare --current ./reports/my_benchmark-*.json nightly
cargo run --release --locked --bin benchora -- list
```

The `--db` flag (or `BENCHORA_DB`) points the CLI at a SQLite file; default `./benchora.db`.

## Key Features

- **Criterion bench harnesses** (`my_benchmark`, `phenotype_xdd_lib_bench`)
- **`benchora` CLI** — `run`, `report`, `baseline`, `compare`, `list`, `mutate`
- **SQLite-backed baseline store** with sha256-pinned integrity hashes
- **Regression detection** — configurable threshold; non-zero exit for CI gates
- **Mutation coverage** — set-based line + branch tracking; `mutation_score` is `Option<f64>`
- **xDD utilities** — property strategies, contract verifier, spec parser/validator
- **Library + binary** — lib is `phenotype_xdd_lib`; CLI is the `benchora` bin

## CLI

| Subcommand | Purpose |
|---|---|
| `benchora run --suite <name> --out <dir>` | Execute a bench suite and write a report |
| `benchora report <report.json>` | Summarize a report to stdout |
| `benchora baseline --from <report.json> <name>` | Promote a report to a named baseline |
| `benchora compare --current <report.json> <baseline>` | Diff a report against a baseline |
| `benchora list [reports\|baselines\|mutations]` | List stored SQLite entries |
| `benchora mutate` | Run mutation testing via `cargo mutants` |

## Publish / release readiness

| Item | Status |
|---|---|
| CI tests | Gating (`cargo test --all --locked`) |
| CHANGELOG | `[0.2.0] - 2026-07-19` |
| GitHub Release | [`v0.2.0`](https://github.com/KooshaPari/Benchora/releases/tag/v0.2.0) |
| crates.io | Published (`benchora` 0.2.0) |

Next-cut runbook: [docs/guides/cutting-a-release.md](./docs/guides/cutting-a-release.md).

crates.io package: [`benchora` on crates.io](https://crates.io/crates/benchora).

## Documentation

- [SPEC.md](./SPEC.md) — framework contract (`@trace BENCH-001` / `BENCH-002` / `BENCH-006`)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — canonical architecture (auditor root)
- [SSOT.md](./SSOT.md) — single source of truth index
- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) — CLI subcommand API surface
- [docs/SCORECARD.md](./docs/SCORECARD.md) — audit grade + WORK_DAG
- [docs/getting-started.md](./docs/getting-started.md) — local build/test
- [docs/guides/cutting-a-release.md](./docs/guides/cutting-a-release.md) — tag + publish runbook
- [docs/slsa.md](./docs/slsa.md) — release attestation notes
- [CHANGELOG.md](./CHANGELOG.md) — Keep a Changelog

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Verify locally (`cargo test --locked`,
`cargo clippy --all-targets -- -D warnings`). Treat CI test failures as blocking.

## License

MIT — see [`LICENSE`](./LICENSE).
