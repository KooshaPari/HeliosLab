# Core Integration

## Objective

Connect HeliosLab configuration, feature flags, secrets, and version metadata through the
workspace CLI so downstream Phenotype services use one operational surface.

## Workflow

1. Load project configuration through the core crate.
2. Resolve feature flags before service initialization.
3. Read secrets from the configured provider.
4. Emit version metadata for diagnostics and release checks.

## CLI Check

```bash
phenoctl --help
```

## Acceptance

- Configuration resolves without falling back to ad hoc environment parsing.
- Feature flags and secrets are accessed through the workspace crates.
- Version output identifies the active build and package set.
