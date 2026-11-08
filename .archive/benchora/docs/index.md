---
layout: home
title: Benchora — Modern Benchmarking for Rust
hero:
  name: Benchora
  text: Modern benchmarking + xDD testing framework
  tagline: Criterion-based bench harness, load testing, and performance regression tracking for Rust.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/KooshaPari/Benchora
features:
  - title: Criterion-Based Bench Harness
    details: Battle-tested statistical benchmarking under the `gauge` crate, with the standard `cargo bench` workflow you already know.
  - title: xDD Tooling
    details: Property-based, contract, mutation, and spec-driven test utilities — all built into one Rust library.
  - title: Phenotype Ecosystem
    details: Drop-in component for performance benchmarking, load testing, and metrics collection across Phenotype projects.
---

## About Benchora

Benchora is the Rust benchmarking and performance-testing framework that powers the
**Phenotype ecosystem**. The library crate is named **`gauge`** (see `Cargo.toml`)
and currently targets pre-1.0: a scaffolded bench harness, xDD testing utilities,
and the foundation for load-testing and metrics-collection adapters.

The framework intentionally combines two concerns in one crate:

- **Benchmarking** — `criterion` harnesses under `benches/` with reproducible
  statistical analysis.
- **xDD methodologies** — property-based testing (`proptest`, `quickcheck`),
  contract testing, mutation coverage tracking, and spec parsing under `src/`.

## Project Overview

- **Language:** Rust (stable, pinned via `rust-toolchain.toml`)
- **Crate name:** `gauge`
- **Bench harness:** [`criterion`](https://github.com/bheisler/criterion.rs) `0.8`
- **License:** MIT (per `Cargo.toml`)

## Key Features

- Rust benchmarking with `criterion`
- Load testing utilities
- Performance regression tracking
- Metrics collection and reporting
- Property-based and contract test scaffolding

## Quick Start

```bash
# Clone
git clone https://github.com/KooshaPari/Benchora
cd Benchora

# Build
cargo build

# Run benchmarks
cargo bench

# Run tests
cargo test
```

See [Getting Started](getting-started.md) for the full walkthrough.

## Repository Layout

```
.
├── benches/         # Criterion bench harnesses
├── src/             # gauge library: property, contract, mutation, spec, domain
├── tests/           # Integration tests
├── docs/            # VitePress site (this site) + design notes
├── .github/         # Workflows, CODEOWNERS, issue templates
├── Cargo.toml       # Crate manifest (name = "gauge")
└── README.md
```

## Traceability

All requirements are tracked through the `BENCH-NNN` ID scheme; see
[`SPEC.md`](https://github.com/KooshaPari/Benchora/blob/main/SPEC.md) and the
`/// @trace BENCH-001` markers in source. Governance / SSOT index:
[`SSOT.md`](https://github.com/KooshaPari/Benchora/blob/main/SSOT.md),
architecture: [`ARCHITECTURE.md`](https://github.com/KooshaPari/Benchora/blob/main/ARCHITECTURE.md),
audit lift DAG: [`docs/SCORECARD.md`](./SCORECARD.md).

## Contributing

PRs are welcome. See
[`CONTRIBUTING.md`](https://github.com/KooshaPari/Benchora/blob/main/CONTRIBUTING.md)
for workflow, conventional-commit style, and the local quality gate
(`cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`, `cargo build --release`).

## License

MIT — see [`LICENSE`](https://github.com/KooshaPari/Benchora/blob/main/LICENSE).
