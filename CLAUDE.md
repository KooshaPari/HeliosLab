# phenotype-config

Rust workspace providing a local-first configuration SDK for Phenotype projects.

## Crates

- **pheno-core** — Core types (ConfigEntry, FeatureFlag, SecretEntry, VersionInfo) and store traits
- **pheno-db** — SQLite backend with auto-migration, CRUD, audit trail, and point-in-time restore
- **pheno-crypto** — AES-256-GCM encryption for secrets
- **pheno-cli** — `phenoctl` binary with clap CLI and ratatui TUI

## Usage

```bash
cargo build
./target/debug/phenoctl --help
```

Default DB path: `<repo>/.phenotype/config.db`
