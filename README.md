# HeliosLab

A TypeScript + Rust monorepo lab for Phenotype infrastructure experiments — a hybrid browser + code editor desktop shell, a multi-architecture CLI, and domain-agnostic benchmarking. Think of HeliosLab as the proving ground where new Phenotype subsystems are prototyped before graduating to dedicated repositories.

[![CI](https://github.com/KooshaPari/HeliosLab/actions/workflows/ci.yaml/badge.svg)](https://github.com/KooshaPari/HeliosLab/actions/workflows/ci.yaml)

## Repository Map

```
HeliosLab/
├── apps/                          # TS/Bun application packages
│   ├── desktop/                   #   Electrobun desktop shell
│   ├── runtime/                   #   Runtime execution context
│   ├── renderer/                  #   Shared rendering layer
│   └── colab-renderer/            #   Legacy colab views
├── packages/                      # Shared TS library packages
│   ├── errors/                    # Typed error primitives
│   ├── ids/                       # Identifier generation & validation
│   ├── logger/                    # Structured logging
│   ├── runtime-core/              # Core runtime abstractions
│   └── types/                     # Shared type definitions
├── pheno-cli/                     # Rust CLI binary (phenoctl)
├── pheno-core/                    # Shared types, config, feature flags
├── pheno-db/                      # Local storage & persistence
├── pheno-crypto/                  # Cryptographic primitives & key mgmt
├── crates/
│   ├── pheno-ffi-python/          # Python FFI bridge (PyO3)
│   └── pheno-ffi-go/              # Go FFI bridge (cgo)
├── src/                           # Desktop app source tree
│   ├── main/helioslab.ts          #   Electrobun entrypoint
│   ├── renderers/                 #   Web views (helioslab, bunny, ivde)
│   ├── pty/                       #   Terminal emulation (xterm)
│   ├── hooks/                     #   App lifecycle hooks
│   ├── i18n/                      #   Internationalisation
│   ├── styles/                    #   Global styles
│   ├── config/                    #   Client config
│   ├── shared/                    #   Shared TS utilities
│   ├── docs/                      #   App-local documentation views
│   ├── helios_bench/              #   Python benchmark harness
│   └── bun/                       #   Bun runtime helpers
├── contracts/                     # Interface contracts
│   └── polyglot-config-core.contract.json
├── docs/                          # VitePress documentation site
│   ├── adr/                       # Architecture Decision Records
│   ├── journeys/                  # User journeys & workflows
│   ├── api/                       # API reference
│   ├── specs/                     # Specifications
│   └── wiki/                      # Project wiki
├── just/                          # Shared justfile library
│   └── phenotype.just
├── scripts/                       # Developer tooling scripts
├── tools/                         # Vendored tooling
├── electrobun.config.ts           # Electrobun desktop configuration
├── justfile                       # Recipe runner (re-exports just/phenotype.just)
├── Taskfile.yml                   # Task runner configuration
├── .nvmrc                         # Node.js version (20)
└── rust-toolchain.toml            # Rust toolchain (stable)
```

## Architecture

Three primary runtimes coexist in this monorepo:

| Layer | Runtime | Location | Purpose |
|-------|---------|----------|---------|
| **Desktop Shell** | TypeScript + Bun (electrobun) | `apps/ + src/` | Hybrid browser + code editor wrapping Rust sidecars |
| **CLI & Libraries** | Rust (edition 2021) | `pheno-*` crates | `phenoctl` CLI, crypto, DB, FFI bridges |
| **Benchmarking** | Python >= 3.12 | `src/helios_bench/` | Terminal Bench-style CLI benchmark harness |

The electrobun desktop bundles web views (helioslab, ivde, bunny) with a Rust sidecar for crypto, persistence, and platform integration. The Rust workspace produces the `phenoctl` binary and FFI libraries callable from Python (PyO3) and Go (cgo). The Python benchmark harness (`helios-bench`) is a standalone CLI for measuring system and procesperformance.

Cross-repo dependencies:
- **PhenoObservability** — `pheno-otel` for OTLP trace export (tagged `v0.1.0`)
- **PhenoInfra** — `phenotype-crypto`, `phenotype-health`, `phenotype-observability`, `phenotype-state-machine` (pinned rev)

## Prerequisites

| Tool | Version | Required For |
|------|---------|--------------|
| Rust | >= 1.75 (stable) | All Rust crates |
| Node.js | >= 20 (see `.nvmrc`) | TypeScript typechecking, linting |
| Bun | latest | Electrobun desktop, TS package scripts |
| Go | >= 1.21 | `pheno-ffi-go` only |
| Python | >= 3.12 | `helios-bench` benchmark harness |
| `just` | latest | Recipe runner |
| `go-task` / `task` | latest | Taskfile runner |
| `cargo-deny` | latest | License/dependency audit |
| `biome` | 2.5.x | TS/JS linting & formatting |

## Getting Started

```bash
# Clone
git clone https://github.com/KooshaPari/HeliosLab.git
cd HeliosLab

# Rust toolchain
rustup show                          # verify channel & targets
cargo check --workspace              # verify all crates compile
cargo build --release                # build phenoctl + FFI libs

# TS packages + desktop
bun install                          # install workspace dependencies
bun run typecheck                    # verify types across all TS packages
bun run lint                         # biome check

# Python benchmark harness
uv sync                              # create venv, install helios-bench
helios-bench tasks                   # list available benchmarks

# Quick validation
just build                           # build all (Rust + verify)
just test                            # run Rust test suite
```

## Key Commands

| Command | Target | Description |
|---------|--------|-------------|
| `cargo run --bin phenoctl` | Rust | Run the `phenoctl` CLI |
| `cargo test --workspace` | Rust | Run all Rust unit + integration tests |
| `cargo deny check` | Rust | License / security audit |
| `bun run typecheck` | TypeScript | TypeScript type checking |
| `bun run lint` | TypeScript | Biome lint |
| `bun run format` | TypeScript | Biome format |
| `bun run setup` | TypeScript | Generate dependency verify files |
| `helios-bench` | Python | Run benchmark harness |
| `just build` | All | Build all Rust crates |
| `just test` | All | Run test suite |
| `just lint` | All | Lint check |
| `just doc` | All | Generate docs preview |
| `just deny` | All | Cargo-deny audit |
| `just grade` | All | Print tier-0 hygiene score |
| `just ci` | All | Full CI simulation (lint → test → deny) |

## Documentation

- **Architecture Decisions** — `docs/adr/`
- **User Journeys** — `docs/journeys/` (Quick Start, Core Integration, Production Setup)
- **API Reference** — `docs/api/`
- **Development Guide** — `docs/development-guide.md`
- **Specifications** — `docs/specs/`
- **Governance** — `docs/governance/`

## License

Licensed under **MIT OR Apache-2.0** (dual-licensed). See the LICENSE file for details.