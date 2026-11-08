---
title: Getting Started
---

# Getting Started

This guide walks you through cloning, building, testing, and benchmarking
**Benchora** (crate name: `benchora`, library: `phenotype_xdd_lib`) on a local
machine.

## Prerequisites

- **Rust toolchain** — stable channel, components `rustfmt` and `clippy`
  (pinned via `rust-toolchain.toml`).
- **`cargo`** — bundled with Rust.
- **`pre-commit`** _(optional but recommended)_ — `pip install pre-commit`.
- **Node.js ≥ 18** _(only required to edit this documentation site locally)_.

Verify your toolchain:

```bash
rustc --version
cargo --version
```

## Clone

```bash
git clone https://github.com/KooshaPari/Benchora
cd Benchora
```

## Install the CLI

`benchora` is **not published on crates.io** yet. From a clone:

```bash
cargo install --path . --locked
```

Or from GitHub:

```bash
cargo install --git https://github.com/KooshaPari/Benchora --locked
```

## Install Hooks (Optional)

The repository ships a `.pre-commit-config.yaml` with the standard
`pre-commit-hooks` checks:

```bash
pre-commit install
```

## Build

```bash
cargo build --locked
```

This compiles the `phenotype_xdd_lib` library and the `benchora` binary in debug
mode.

## Run Tests

```bash
cargo test --locked
```

Unit tests live next to source under `src/`; integration tests live under
`tests/`.

## Run Benchmarks

```bash
cargo bench
```

Bench harnesses live in `benches/` and use
[`criterion`](https://github.com/bheisler/criterion.rs). The scaffold includes
`benches/my_benchmark.rs` as a working starting point.

## Pre-Release Build

For an optimized release build (matches the local quality gate):

```bash
cargo build --release --locked
```

## Local Quality Gate

Before opening a PR, run the full local quality suite:

```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo test --locked
cargo build --release --locked
```

A `task` runner is also provided — see `Taskfile.yml`:

```bash
task build    # cargo build --workspace --all-features
task test     # cargo test --workspace --all-features
task fmt      # cargo fmt --all
task lint     # cargo clippy --workspace --all-features --all-targets -- -D warnings
task audit    # cargo deny check advisories
task quality  # full gate: fmt + lint + test + audit
```

## Documentation Site

This site is built with [VitePress](https://vitepress.dev/) from the `docs/`
directory and is deployed automatically to GitHub Pages on every push to
`main` (see `.github/workflows/docs.yml`).

To preview the docs locally:

```bash
npm install
npm run docs:dev      # http://localhost:5173
npm run docs:build     # produces docs/.vitepress/dist
npm run docs:preview   # serve the built site
```

## Project Layout

```
.
├── benches/                 # Criterion bench harnesses
├── src/                     # phenotype_xdd_lib + CLI modules
│   ├── bin/benchora.rs      # CLI entrypoint
│   ├── cli/                 # run / report / baseline / compare / mutate
│   ├── contract/            # Port/Adapter verification
│   ├── domain/              # Pure business types + errors
│   ├── mutation/            # Mutation coverage tracking
│   ├── property/            # proptest / quickcheck strategies
│   └── spec/                # Spec parsing/validation
├── tests/                   # Integration tests
├── docs/                    # VitePress site (this site)
├── .github/workflows/       # CI / CD / security workflows
├── Cargo.toml               # Crate manifest — name = "benchora"
├── rust-toolchain.toml      # Stable channel + rustfmt + clippy
└── README.md
```

## Next Steps

- Read the [crate-level docs](https://github.com/KooshaPari/Benchora) — start
  with `src/lib.rs` for the public API surface.
- Skim [`SPEC.md`](https://github.com/KooshaPari/Benchora/blob/main/SPEC.md)
  for the framework contract and the `BENCH-NNN` traceability scheme.
- See [SLSA](slsa.md) for supply-chain provenance notes.
- Open a PR — see
  [`CONTRIBUTING.md`](https://github.com/KooshaPari/Benchora/blob/main/CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](https://github.com/KooshaPari/Benchora/blob/main/LICENSE).
