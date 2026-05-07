# Deployment Configuration

This document describes the deployment configuration for HeliosLab.

## Current Status

HeliosLab is a Rust workspace (`pheno-core`, `pheno-db`, `pheno-crypto`, `pheno-cli`). It currently has no Docker or Kubernetes manifests. Deployment is via native Rust binary builds.

## Build

```bash
# Release build
cargo build --release

# Workspace build
cargo build --workspace --release
```

## Local Run

```bash
./target/release/phenoctl --help
```

Default database path: `<repo>/.phenotype/config.db`

## Taskfile Commands

| Task | Command |
|------|---------|
| lint | `cargo clippy --all-targets -- -D warnings && cargo fmt -- --check` |
| test | `cargo test --all` |
| quality | lint + test |
| build | `cargo build --release` |
| check | `cargo check --all-targets` |

## crates

| Crate | Purpose |
|-------|---------|
| `pheno-core` | Core types: ConfigEntry, FeatureFlag, SecretEntry, VersionInfo |
| `pheno-db` | SQLite backend with auto-migration, CRUD, audit trail |
| `pheno-crypto` | AES-256-GCM encryption for secrets |
| `pheno-cli` | `phenoctl` binary with clap CLI and ratatui TUI |

## Future Deployment

When adding containerized deployment, align with the pattern established in `HeliosCLI`:
- Deployment with 3 replicas
- Liveness/readiness probes on health port
- 256Mi/250m request, 512Mi/500m limit
- Prometheus metrics endpoint at `/metrics`
