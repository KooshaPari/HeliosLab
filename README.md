# HeliosLab

A TypeScript + Rust monorepo lab for Phenotype projects — journeys, contracts, and desktop tooling.

## What It Is

HeliosLab is the development workspace for Phenotype infrastructure experiments. It houses the `phenoctl` CLI binary, core configuration and crypto crates, FFI bridges to Python and Go, an agent platform layer, and a Go-based CLI variant. Think of it as the place where new Phenotype subsystems are prototyped before graduating to dedicated repositories.

## Architecture

The Rust workspace (resolver v2) contains six crates unified behind the `phenoctl` CLI:

```text
phenoctl (binary)
  ├── pheno-core       Shared types, config, and feature-flag logic
  ├── pheno-db         Local storage and persistence abstractions
  ├── pheno-crypto     Cryptographic primitives and key management
  ├── pheno-cli        CLI entrypoint (clap-based) and TUI
  ├── pheno-ffi-python Python FFI bridge via PyO3
  └── pheno-ffi-go     Go FFI bridge via cgo
```

A parallel TypeScript layer under `Agentora/` provides agent platform adapters, runtime orchestration, and intent-routing examples. A Go-based CLI variant (`pheno-cli-go/`) implements plugin scaffolding, audit, and rollout commands.

Cross-repo dependencies pull from:

- **PhenoInfra** — crypto, health, observability, state-machine crates
- **PhenoObservability** — `pheno-otel` for OTLP trace export

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | >= 1.75 (edition 2021) | See `rust-toolchain.toml` for pinned MSRV |
| cargo-deny | latest | Run `cargo deny check` before CI |
| Node.js | >= 20 | For the TypeScript agent layer |
| Go | >= 1.21 | For `pheno-cli-go` only |
| Python | >= 3.10 | For `pheno-ffi-python` build only |

## Quick Start

```bash
# Clone and build
git clone https://github.com/KooshaPari/HeliosLab.git
cd HeliosLab
cargo build --workspace

# Install the CLI
cargo install --path pheno-cli

# Set configuration
phenoctl config set app.name "My App"

# Manage feature flags
phenoctl flags create dark-mode --description "Enable dark mode"
phenoctl flags enable dark-mode

# Store secrets
phenoctl secrets set API_KEY

# Inspect versions
phenoctl version show

# Launch the TUI
phenoctl tui
```

## Project Structure

```text
HeliosLab/
├── pheno-core/           Rust crate — shared config, flags, versioning
├── pheno-db/             Rust crate — local persistence
├── pheno-crypto/         Rust crate — crypto primitives
├── pheno-cli/            Rust crate — phenoctl binary and TUI
├── crates/
│   ├── pheno-ffi-python/ Rust crate — Python FFI via PyO3
│   └── pheno-ffi-go/     Rust crate — Go FFI bridge
├── pheno-cli-go/         Go CLI — plugin, audit, rollout commands
├── Agentora/             TS agent platform — adapters, runtime, intents
├── config/               Default configuration and templates
├── docs/                 VitePress documentation
├── Cargo.toml            Workspace manifest
├── deny.toml             cargo-deny policy
└── rust-toolchain.toml   Pinned Rust toolchain
```

## Development

```bash
# Build everything
cargo build --workspace

# Run tests
cargo test --workspace

# Lint and deny checks
cargo clippy --workspace -- -D warnings
cargo deny check
cargo audit

# Format
cargo fmt --all -- --check

# TypeScript agent layer (inside Agentora/)
cd Agentora/adapters/web/agent-platform
npm install
npm test
```

## Contributing

1. Fork the repository and create a feature branch.
2. Make changes following existing code conventions.
3. Run `cargo test --workspace`, `cargo clippy`, and `cargo deny check` before pushing.
4. Open a pull request with a clear description of the change.
5. One reviewer required; no force-pushes to `main`.

## License

Licensed under either of:

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option.

## Related Repos

| Repository | Description |
|-----------|-------------|
| [PhenoInfra](https://github.com/KooshaPari/PhenoInfra) | Shared infrastructure crates (crypto, health, observability, state-machine) |
| [PhenoObservability](https://github.com/KooshaPari/PhenoObservability) | OTLP observability and `pheno-otel` |
| [pheno](https://github.com/KooshaPari/pheno) | Phenotype Infrastructure Kit — 85 crates |
| [phenotooling](https://github.com/KooshaPari/phenotooling) | Org-internal tooling (Rust + TS) |
| [omniroute](https://github.com/KooshaPari/omniroute) | AI model routing proxy |
