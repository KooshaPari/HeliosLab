# HeliosLab Functional & Non-Functional Requirements Registry

**Status:** Starter registry (backfilled 2026-05-31)  
**Repo:** https://github.com/KooshaPari/HeliosLab  
**Stack:** Rust workspace (6 crates), phenotype-config SDK

---

## Functional Requirements

### FR-HLAB-001: Configuration Management
**Description:** Local-first config SDK for Phenotype projects; persistent key-value store with audit trail (ConfigEntry domain model)  
**Status:** Shipped  
**Scope:** pheno-core, pheno-db

### FR-HLAB-002: Feature Flag Lifecycle
**Description:** Create, enable, disable, query feature flags with versioned state tracking; audit history per flag  
**Status:** Shipped  
**Scope:** pheno-core, pheno-db

### FR-HLAB-003: Secret Value Storage Abstraction
**Description:** AES-256-GCM encrypted secret storage with pluggable backend (SQLite default)  
**Status:** Shipped  
**Scope:** pheno-crypto, pheno-db

### FR-HLAB-004: Version Inspection & Rollout State
**Description:** VersionInfo domain model; track app/service versioning and rollout progress  
**Status:** Shipped

### FR-HLAB-005: CLI Tooling (phenoctl)
**Description:** `phenoctl` binary with clap CLI and ratatui TUI for operational workflows (config set, flags create/enable, secrets set, version show, tui)  
**Status:** Shipped  
**Scope:** pheno-cli/src/main.rs

### FR-HLAB-006: SQLite Backend with Auto-Migration
**Description:** pheno-db provides SQLite persistence with auto-migration, CRUD operations, point-in-time restore, audit trail  
**Status:** Shipped  
**Scope:** pheno-db crate

### FR-HLAB-007: Python FFI
**Description:** pheno-ffi-python crate enabling config/secrets access from Python applications  
**Status:** Shipped

### FR-HLAB-008: Go FFI
**Description:** pheno-ffi-go crate enabling config/secrets access from Go applications  
**Status:** Shipped

### FR-HLAB-009: Unified Documentation (VitePress)
**Description:** Centralized docs/ with Wiki, Development Guide, Document Index, API, Roadmap  
**Status:** Shipped

---

## Non-Functional Requirements

### NFR-HLAB-001: Type Safety & Rust Best Practices
**Description:** Strict type system, MSRV pinned (rust-toolchain.toml), cargo-deny for CVEs, weekly cargo-audit  
**Status:** Shipped

### NFR-HLAB-002: Security (Encryption)
**Description:** AES-256-GCM for secrets at rest; encrypted config export/import  
**Status:** Shipped  
**Scope:** pheno-crypto

### NFR-HLAB-003: Auditability
**Description:** SQLite audit trail table; point-in-time restore; all config/secret mutations logged with timestamp, user, change metadata  
**Status:** Shipped

### NFR-HLAB-004: Cross-Platform Compatibility
**Description:** Rust + SQLite + FFI bindings support Linux, macOS, Windows; default DB path `.phenotype/config.db`  
**Status:** Shipped

### NFR-HLAB-005: Operability
**Description:** Terminal UI (ratatui) for ops workflows; human-readable config format (config/ defaults); CLI-first design  
**Status:** Shipped

---

## Architecture & Crates

| Crate | Role |
|-------|------|
| `pheno-core` | Domain types (ConfigEntry, FeatureFlag, SecretEntry, VersionInfo) + store traits |
| `pheno-db` | SQLite backend, auto-migration, CRUD, audit trail, point-in-time restore |
| `pheno-crypto` | AES-256-GCM encryption for secrets |
| `pheno-cli` | `phenoctl` binary; clap CLI + ratatui TUI |
| `pheno-ffi-python` | Python bindings |
| `pheno-ffi-go` | Go bindings |

---

## Traceability Notes

- **Specification & Architecture:**  
  - Product Requirements Document (PRD.md)  
  - Architecture Decisions (ADR.md)  
  - Specification (SPEC.md)  
  - Functional Requirements (FUNCTIONAL_REQUIREMENTS.md)  
  - Implementation Plan (PLAN.md)  

- **Conventions:**  
  - Feature branches via phenoRouterMonitor shelf (worktrees/<topic>/)  
  - Tracked in AgilePlus  
  - MIT license, Phenotype-org governance supersedes local rules  

- **Install:** `cargo install --path pheno-cli`  
- **Default DB:** `<repo>/.phenotype/config.db`
