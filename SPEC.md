# phenotype-config Specification

> Local-first configuration, feature flags, secrets, and version tracking

## Overview

phenotype-config provides configuration management, feature flag lifecycle, secret storage, and version tracking for Phenotype projects with CLI-first workflows.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    phenotype-config                               │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │   Config     │ │  Feature     │ │   Secrets    │          │
│  │   Manager    │ │  Flags       │ │   Store      │          │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘          │
│         └────────────────┼────────────────┘                     │
│                          │                                       │
│                   ┌──────┴───────┐                              │
│                   │  Version     │                              │
│                   │  Tracker     │                              │
│                   └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `phenoctl config set` | Set configuration value |
| `phenoctl flags create` | Create feature flag |
| `phenoctl flags enable/disable` | Toggle flag state |
| `phenoctl secrets set` | Store secret value |
| `phenoctl version show` | Show version info |
| `phenoctl tui` | Launch terminal UI |

## Data Models

```toml
[config]
key = "value"
source = "local"  # local | team | global

[feature_flags]
name = "dark-mode"
enabled = true
rollout_percentage = 100

[secrets]
key = "API_KEY"
storage = "keyring"  # keyring | encrypted_file
```

## Performance Targets

| Operation | Target |
|-----------|--------|
| Config read | <1ms |
| Flag toggle | <5ms |
| Secret access | <10ms |
| TUI startup | <200ms |
