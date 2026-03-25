# phenotype-config

Local-first configuration, feature flags, secrets, and version tracking for Phenotype projects.

## Overview

`phenotype-config` provides a consistent way to manage local and team configuration with auditable change history and CLI-first workflows.

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
