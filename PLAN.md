# Implementation Plan — phenotype-config (colab)

**Project:** phenotype-config  
**Last Updated:** 2026-03-27  
**Status:** In Progress

---

## Phase 1: Workspace Foundation

### P1.1 — Rust workspace scaffold
**Status:** Complete  
**Depends on:** —  
Establish `Cargo.toml` workspace with `pheno-core`, `pheno-db`, `pheno-crypto`, `pheno-cli`, `crates/pheno-ffi-python`, `crates/pheno-ffi-go` crates. Set workspace resolver = "2", edition = "2021".

### P1.2 — Core types and traits (`pheno-core`)
**Status:** Complete  
**Depends on:** P1.1  
Define `ValueType`, `ConfigEntry`, `FeatureFlag`, `SecretEntry`, `VersionRecord`, `AuditEntry`, and shared error types. No I/O or FFI dependencies.

### P1.3 — SQLite persistence layer (`pheno-db`)
**Status:** Complete  
**Depends on:** P1.2  
Implement `Database::open()` with WAL mode and `PRAGMA foreign_keys=ON`. Add idempotent `migrate()` that creates all tables (`config_entries`, `feature_flags`, `secrets`, `version_records`, `config_audit`). Location: `<repo>/.phenotype/config.db`.

### P1.4 — Crypto layer (`pheno-crypto`)
**Status:** Complete  
**Depends on:** P1.2  
AES-256-GCM encryption/decryption via `aes-gcm` crate. Expose `encrypt(plaintext, key) -> CipherBundle` and `decrypt(bundle, key) -> plaintext`. Key derivation from passphrase via Argon2id.

---

## Phase 2: CLI Implementation

### P2.1 — CLI binary skeleton (`pheno-cli`)
**Status:** Complete  
**Depends on:** P1.3, P1.4  
Bootstrap `clap` command tree: `config`, `flags`, `secrets`, `version`, `tui`. Implement database init on first run; locate DB at `$PHENOTYPE_DB` or `<cwd>/.phenotype/config.db`.

### P2.2 — `config` subcommands
**Status:** Complete  
**Depends on:** P2.1  
Implement `config set`, `config get`, `config list`, `config delete`, `config export`, `config import`. All writes append to `config_audit` table.

### P2.3 — `flags` subcommands
**Status:** Complete  
**Depends on:** P2.1  
Implement `flags create`, `flags enable`, `flags disable`, `flags delete`, `flags list`, `flags show`. Store flag state and rollout percentage in `feature_flags`.

### P2.4 — `secrets` subcommands
**Status:** Complete  
**Depends on:** P2.1, P1.4  
Implement `secrets set`, `secrets get`, `secrets delete`, `secrets list`. Encrypt values at rest with AES-256-GCM before writing to `secrets` table.

### P2.5 — `version` subcommands
**Status:** Complete  
**Depends on:** P2.1  
Implement `version show`, `version set`, `version list`, `version promote`, `version rollback`. Track stage transitions (`dev` → `staging` → `production`) in `version_records`.

### P2.6 — TUI (`ratatui`)
**Status:** In Progress  
**Depends on:** P2.2, P2.3, P2.4, P2.5  
Interactive terminal UI with tabbed panels for config, flags, secrets, version. Real-time refresh, keyboard navigation, inline editing. Implemented in `pheno-cli/src/tui.rs`.

---

## Phase 3: FFI Bindings

### P3.1 — Python FFI crate (`pheno-ffi-python`)
**Status:** In Progress  
**Depends on:** P1.3  
Expose `phenoconfig` Python package via `pyo3`. Wrap `Database`, `ConfigEntry`, `FeatureFlag` types. Publish as `phenotype-config` on PyPI (or local build via `maturin`).

### P3.2 — Go FFI crate (`pheno-ffi-go`)
**Status:** In Progress  
**Depends on:** P1.3  
Expose C ABI via `cbindgen`-generated `pheno.h`. Go package `phenoconfig` wraps C calls with idiomatic Go types. Used by Go services in the Phenotype ecosystem.

### P3.3 — Polyglot contract validation
**Status:** Planned  
**Depends on:** P3.1, P3.2  
`contracts/polyglot-config-core.contract.json` defines the interop surface. Gate validates that Python and Go bindings implement all contract methods via `tools/gates/protocol-parity.mjs`.

---

## Phase 4: Documentation and Quality

### P4.1 — VitePress docsite
**Status:** In Progress  
**Depends on:** P2.6  
Docs categories: Wiki, Development Guide, API, Roadmap. Served via `docs/` with `.vitepress/` config. Build: `bun run docs:build`.

### P4.2 — Spec verification
**Status:** Planned  
**Depends on:** P4.1  
All 34 FRs in `FUNCTIONAL_REQUIREMENTS.md` must have corresponding tests. FR IDs tagged in test functions. Run `task quality` to verify spec coverage.

### P4.3 — CI/CD pipeline
**Status:** Planned  
**Depends on:** P4.2  
GitHub Actions workflow: `cargo test --workspace`, `cargo clippy -- -D warnings`, `cargo fmt --check`, FFI build smoke test, polyglot parity gate.

---

## Cross-Project Reuse Opportunities

- `pheno-core` types are candidates for extraction to a `phenotype-shared` crate shared across Phenotype Rust projects.
- The polyglot contract validation gate (`tools/gates/protocol-parity.mjs`) pattern is reusable in `agentops-policy-federation` and any other multi-language binding repo.
- Migration order: stabilize `pheno-core` API → publish to crates.io or Cargo git dep → update callers.
