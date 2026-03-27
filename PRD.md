# Product Requirements Document — phenotype-config (colab)

**Status:** ACTIVE
**Owner:** Phenotype Engineering
**Last Updated:** 2026-03-26

---

## Overview

`phenotype-config` is a local-first Rust SDK and CLI that provides Phenotype projects with a unified, auditable, and encrypted configuration surface. It covers four concern domains: application configuration, feature flag lifecycle, secrets management, and version/release-stage tracking. All data is persisted locally in a SQLite database with WAL mode; no remote dependency is required.

The system is delivered as:
- A Rust workspace with four crates (`pheno-core`, `pheno-db`, `pheno-crypto`, `pheno-cli`) plus FFI shims for Python and Go.
- A `phenoctl` CLI binary.
- A `ratatui`-based TUI for interactive exploration.

---

## E1: Configuration Management

### E1.1: Namespaced Key-Value Store
As a developer, I want to set, get, and delete typed configuration entries (string, int, float, bool, JSON) in named namespaces so that runtime settings are isolated per concern.

**Acceptance Criteria:**
- `phenoctl config set <key> <value>` writes to the default namespace.
- `phenoctl config get <key>` retrieves the current value with its type.
- `phenoctl config list` shows all entries in a namespace.
- `phenoctl config delete <key>` removes an entry.
- Supported types: `string`, `int`, `float`, `bool`, `json`.
- Entries are persisted in `<repo>/.phenotype/config.db` (SQLite, WAL mode).

### E1.2: Audit Trail for Config Changes
As an operator, I want every config change recorded in an audit log so that I can trace who changed what and when.

**Acceptance Criteria:**
- Every write to `config_entries` records old value, new value, `changed_by`, and timestamp in `config_audit`.
- `phenoctl config audit <key>` displays the audit history for a key.
- Audit records are immutable (append-only table).

---

## E2: Feature Flag Lifecycle

### E2.1: Flag Creation and Toggle
As a developer, I want to create feature flags and enable/disable them so that I can gate functionality without code deployments.

**Acceptance Criteria:**
- `phenoctl flags create <name> --description <text>` creates a flag at stage `SP` (Specification/Planning).
- `phenoctl flags enable <name>` and `phenoctl flags disable <name>` toggle a flag.
- `phenoctl flags list` shows all flags with their state, stage, and transience class.
- `phenoctl flags get <name>` shows full flag detail.

### E2.2: Stage Lifecycle (16 Stages)
As a release manager, I want flags to be associated with one of 16 lifecycle stages so that I can track readiness and enforce promotion gates.

**Acceptance Criteria:**
- Stages in order: `SP -> POC -> IP -> A -> FP -> B -> EP -> CN -> RC -> GA -> LTS -> HF -> SS -> DEP -> AR -> EOL`.
- `phenoctl flags promote <name> <stage>` advances a flag to a target stage (forward-only).
- Reverse transitions are rejected with a clear error: `invalid stage transition`.
- `phenoctl stage list` shows all flags grouped by stage.

### E2.3: Transience Classes and Channel Gating
As a developer, I want flags to carry a transience class (F=Permanent, T=Transient, E=Experimental) and channel list so that flags are only active in appropriate release channels.

**Acceptance Criteria:**
- Flags carry `transience_class` (F, T, or E) and `channel` (JSON array, e.g. `["dev","beta"]`).
- Transience class `T` flags must have a `retire_at_stage` set.
- `TransienceClass::valid_at_stage()` gate is enforced at flag evaluation time.
- `phenoctl flags promote` validates transience constraints before writing.

---

## E3: Secrets Management

### E3.1: Encrypted Secret Storage
As a developer, I want secrets stored encrypted in the local database so that plaintext credentials never appear in config files or version control.

**Acceptance Criteria:**
- `phenoctl secrets set <name>` reads value from stdin (not args) and encrypts with AES-256-GCM before writing.
- `phenoctl secrets get <name>` decrypts and prints to stdout.
- `phenoctl secrets list` shows secret names only (not values).
- `phenoctl secrets delete <name>` removes entry.
- Encryption key loaded from `PHENO_SECRET_KEY` env var (hex-encoded 32-byte key).
- `pheno-crypto` generates a random key if none is set (`generate_key()`).

---

## E4: Version and Release Tracking

### E4.1: Version Information Store
As a developer, I want to record and retrieve structured version information per project so that tooling can query release state.

**Acceptance Criteria:**
- `phenoctl version set --semver <x.y.z> --stage <stage> --channel <ch>` writes version record.
- `phenoctl version show` displays current version, stage, and channel.
- Version records are immutable history; each set appends a new row.

---

## E5: Interactive TUI

### E5.1: Ratatui-Based Operational Dashboard
As a developer, I want an interactive terminal UI so that I can browse and edit configuration, flags, secrets, and version info without memorizing CLI syntax.

**Acceptance Criteria:**
- `phenoctl tui` launches the ratatui TUI.
- TUI provides tabs/panels for: Config, Flags, Secrets, Version.
- Keyboard navigation (arrow keys, Enter, Escape) is functional.
- TUI reads from and writes to the same SQLite database as the CLI.

---

## E6: FFI Bindings

### E6.1: Python FFI (pheno-ffi-python)
As a Python developer, I want to call `pheno-core` types from Python so that Phenotype Python services can consume the same config surface.

**Acceptance Criteria:**
- `crates/pheno-ffi-python` builds a Python extension via PyO3.
- At minimum: `get_config`, `set_config`, `get_flag`, `set_flag` are exposed.
- Importable as `import pheno` in a Python environment.

### E6.2: Go FFI (pheno-ffi-go)
As a Go developer, I want to call `pheno-core` types from Go via CGO so that Phenotype Go services share the same config surface.

**Acceptance Criteria:**
- `crates/pheno-ffi-go` exposes a C ABI header.
- At minimum: config get/set and flag get/enable functions are exported.
- Compiles cleanly with `cargo build --release`.

---

## Future Roadmap

- **Phase 2**: Remote config sync (S3/GCS backend) with conflict resolution.
- **Phase 3**: Multi-tenant namespace access control.
- **Phase 4**: gRPC service wrapper for microservice consumption.
- **Phase 5**: Web UI for operational teams.
