# HeliosLab — phenotype-config

Local-first configuration, feature flags, secrets, and version tracking for Phenotype projects. Built with Rust, SQLite, and AES-256 encryption. Provides auditable configuration management with CLI-first and TUI workflows for operational teams.

## Overview

**HeliosLab** (phenotype-config) provides a consistent, cryptographically-secure way to manage application configuration, feature flags, secrets, and version state across Phenotype projects. It emphasizes local-first operation, complete audit trails, and intuitive CLI/TUI workflows for developers and operators.

**Core Mission**: Enable safe, auditable configuration management with zero server dependencies and powerful CLI/TUI tooling for teams at scale.

## Technology Stack

- **Language**: Rust (Edition 2024)
- **Storage**: SQLite with auto-migration and audit trail
- **Encryption**: AES-256-GCM for secrets
- **CLI**: clap for argument parsing
- **TUI**: ratatui for terminal UI
- **Key Crates**:
  - `pheno-core` — Core types (ConfigEntry, FeatureFlag, SecretEntry, VersionInfo)
  - `pheno-db` — SQLite backend with CRUD, audit logging, point-in-time restore
  - `pheno-crypto` — Secret encryption/decryption
  - `pheno-cli` — `phenoctl` binary with interactive workflows

## Key Features

- **Configuration Management**: Type-safe config with hierarchical key-value storage
- **Feature Flags**: Lifecycle management (create, enable, disable, track rollout state)
- **Secrets Management**: Encrypted storage with AES-256-GCM
- **Version Tracking**: Application version inspection and rollout state tracking
- **Audit Trail**: Complete change history with timestamps and authors
- **Point-in-Time Restore**: Revert to previous configuration states
- **CLI + TUI**: Rich terminal UI for operational workflows (`phenoctl tui`)
- **Zero Dependencies**: Local SQLite — no external servers required

## Quick Start

```bash
# Clone and explore
git clone <repo-url>
cd HeliosLab

# Build
cargo build --release
./target/debug/phenoctl --help

# Use CLI
phenoctl config set app.name "My App"
phenoctl flags create dark-mode --description "Enable dark mode"
phenoctl flags enable dark-mode
phenoctl secrets set API_KEY
phenoctl version show

# Launch interactive TUI
phenoctl tui
```

## Project Structure

```
HeliosLab/
├── crates/
│   ├── pheno-core/          # Core types and store traits
│   ├── pheno-db/            # SQLite backend & auto-migration
│   ├── pheno-crypto/        # AES-256-GCM encryption
│   └── pheno-cli/           # phenoctl binary
├── config/                  # Default configuration templates
├── docs/                    # VitePress documentation
└── CLAUDE.md, AGENTS.md     # Governance & agent contract
```

## Default DB Path

`<repo>/.phenotype/config.db` (auto-created on first run)

## Related Phenotype Projects

- **[PhenoDevOps](../PhenoDevOps)** — Uses HeliosLab for deployment configuration
- **[AgilePlus](../AgilePlus)** — Configuration and feature flag management
- **[PhenoObservability](../PhenoObservability)** — Observability configuration via HeliosLab