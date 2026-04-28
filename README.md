> **Pinned references (Phenotype-org)**
> - MSRV: see rust-toolchain.toml
> - cargo-deny config: see deny.toml
> - cargo-audit: rustsec/audit-check@v2 weekly
> - Branch protection: 1 reviewer required, no force-push
> - Authority: phenotype-org-governance/SUPERSEDED.md

# HeliosLab

HeliosLab is a Rust workspace providing comprehensive configuration, feature flags, secrets, and version management for Phenotype projects. The workspace contains six core crates—`pheno-core`, `pheno-db`, `pheno-crypto`, `pheno-cli`, `pheno-ffi-python`, and `pheno-ffi-go`—unified around the `phenoctl` CLI binary (entrypoint: `pheno-cli/src/main.rs`).

**Specification & Architecture:**
- [Product Requirements (PRD.md)](./PRD.md)
- [Architecture Decisions (ADR.md)](./ADR.md)
- [Specification (SPEC.md)](./SPEC.md)
- [Functional Requirements (FUNCTIONAL_REQUIREMENTS.md)](./FUNCTIONAL_REQUIREMENTS.md)
- [Implementation Plan (PLAN.md)](./PLAN.md)

## Overview

HeliosLab provides a consistent way to manage local and team configuration with auditable change history and CLI-first workflows.

## Core Capabilities

- Configuration management for app/runtime settings
- Feature flag lifecycle management
- Secret value storage abstractions
- Version inspection and rollout state tracking
- Terminal UI for operational workflows

## Install

```bash
cargo install --path pheno-cli
```

## Quick Start

```bash
phenoctl config set app.name "My App"
phenoctl flags create dark-mode --description "Enable dark mode"
phenoctl flags enable dark-mode
phenoctl secrets set API_KEY
phenoctl version show
phenoctl tui
```

## Repository Structure

- `pheno-cli/` CLI implementation
- `docs/` unified VitePress documentation categories
- `config/` default configuration and templates

## Documentation Categories

- Wiki
- Development Guide
- Document Index
- API
- Roadmap