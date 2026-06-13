# Architecture

## Overview
- HeliosLab (aka `phenotype-config`) is a Rust workspace providing a local-first configuration SDK.
- Stack: Rust (Cargo workspace, resolver v2), with planned FFI targets (Python, Go).
- This document is a skeleton; expand with crate-level ownership and boundaries as the workspace evolves.

## Components
## pheno-core/
- Pure types, traits, and error definitions. No I/O, no FFI. Safe to unit-test without filesystem setup.

## pheno-db/
- SQLite persistence layer (WAL mode, auto-migration). Depends only on `pheno-core`.

## pheno-crypto/
- AES-256-GCM encryption for secret entries. Depends only on `pheno-core`.

## pheno-cli/
- `phenoctl` binary: clap CLI + ratatui TUI. Depends on `pheno-core`, `pheno-db`, `pheno-crypto`.

## crates/pheno-ffi-* (planned)
- Thin FFI shims wrapping `pheno-core` and `pheno-db` for language bindings (Python, Go).

## apps/ (under agileplus-specs)
- Optional companion apps or experiment surfaces driven from this workspace.

## Data flow
```text
consumer (CLI / TUI / FFI) -> pheno-core types
                          -> pheno-db (SQLite WAL) and/or pheno-crypto (AES-256-GCM)
                          -> <repo>/.phenotype/config.db
```

## Key invariants
- `pheno-core` MUST stay I/O-free so FFI crates and unit tests can depend on it without filesystem setup.
- FFI crates MUST depend only on `pheno-core` + `pheno-db`, not on `pheno-cli` (clap, ratatui).
- DB writes go through the `pheno-db` layer; do not bypass it from `pheno-cli` or FFI.
- Secrets MUST be stored encrypted; never persisted in plaintext.

## Cross-cutting concerns (config, telemetry, errors)
- Config: use `pheno-core::ConfigEntry` as the canonical representation.
- Telemetry: out of scope for the SDK itself; embedders can layer tracing.
- Errors: normalize through `pheno-core` error types so all crates report actionable messages.

## Future considerations
- Add startup diagram for the CLI and TUI paths.
- Capture FFI contract decisions once the Python/Go shims land.
- Replace this skeleton with per-crate ADRs (see `ADR.md` for adopted decisions).
