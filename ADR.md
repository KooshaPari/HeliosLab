# Architecture Decision Records — phenotype-config (colab)

**Last Updated:** 2026-03-26

---

## ADR-001 | Rust Workspace with Layered Crates | Adopted

**Status:** Adopted

**Context:**
A local-first configuration SDK must be embeddable as a library, usable as a CLI, and bindable from multiple languages (Python, Go). Monolithic designs make language bindings awkward and force all consumers to link the full dependency graph.

**Decision:**
Implement as a Rust Cargo workspace with strict layer separation:
- `pheno-core` — pure types, traits, and error definitions. No I/O, no FFI.
- `pheno-db` — SQLite persistence layer; depends only on `pheno-core`.
- `pheno-crypto` — AES-256-GCM encryption; depends only on `pheno-core`.
- `pheno-cli` — binary; depends on all three library crates.
- `crates/pheno-ffi-python` and `crates/pheno-ffi-go` — thin FFI shims wrapping `pheno-core` and `pheno-db`.

**Consequences:**
- FFI crates depend only on `pheno-core` + `pheno-db`, not on CLI deps (clap, ratatui).
- `pheno-core` has zero I/O dependencies, making it safe to unit-test without filesystem setup.
- Adding a new FFI target (e.g., Node.js via napi-rs) requires only a new crate, not modifying existing ones.
- Workspace resolver `2` ensures edition-2021 feature unification rules apply uniformly.

**Code locations:** `Cargo.toml` (workspace), `pheno-core/`, `pheno-db/`, `pheno-crypto/`, `pheno-cli/`, `crates/`

---

## ADR-002 | SQLite with WAL Mode as the Local Store | Adopted

**Status:** Adopted

**Context:**
The SDK must operate fully offline with no external service dependency. Data includes config entries, feature flags, secrets (encrypted), version records, audit logs, and stage transition history. The store must support concurrent reads from multiple processes (e.g., TUI and CLI running simultaneously).

**Decision:**
Use SQLite via `rusqlite` as the sole storage backend. On open, enable:
- `PRAGMA journal_mode=WAL` — allows concurrent readers with a single writer without blocking.
- `PRAGMA foreign_keys=ON` — enforces referential integrity across tables.

Database file is located at `<repo>/.phenotype/config.db`. Parent directories are created automatically on first open.

**Consequences:**
- Zero network dependency; the SDK works in air-gapped environments.
- WAL mode allows the TUI and CLI to read concurrently without file locking conflicts.
- Auto-migration via idempotent `CREATE TABLE IF NOT EXISTS` DDL means no separate migration command is needed.
- SQLite is not suitable for high-write-concurrency multi-process workloads; this is acceptable because the CLI and TUI are single-user tools.

**Code locations:** `pheno-db/src/lib.rs` — `Database::open()`, `Database::migrate()`

---

## ADR-003 | AES-256-GCM for Secret Encryption | Adopted

**Status:** Adopted

**Context:**
Secrets (API keys, tokens) must not be stored in plaintext. The encryption must be deterministic in the sense that the same key always decrypts the same ciphertext, but each encryption operation must produce a unique ciphertext to prevent frequency analysis.

**Decision:**
Use `aes-gcm` crate with AES-256-GCM:
- 256-bit key loaded from `PHENO_SECRET_KEY` environment variable (hex-encoded).
- 96-bit nonce generated fresh per encryption via `OsRng` (cryptographically secure).
- Ciphertext and nonce stored separately in the database (not concatenated).
- If `PHENO_SECRET_KEY` is absent, the system fails with a loud error — no silent plaintext fallback.

**Consequences:**
- Authenticated encryption: any tampering with ciphertext causes decryption to fail with an authentication error.
- Unique nonce per write ensures identical plaintexts produce distinct ciphertexts.
- Key management is the operator's responsibility; the SDK does not implement key derivation or key rotation.
- Key rotation requires re-encrypting all secrets with the new key (not currently automated).

**Code locations:** `pheno-crypto/src/lib.rs`

---

## ADR-004 | 16-Stage Feature Flag Lifecycle | Adopted

**Status:** Adopted

**Context:**
Feature flags at Phenotype span the full product lifecycle, from initial specification through end-of-life. A binary `enabled/disabled` state is insufficient to capture readiness levels, channel gating, or retirement triggers.

**Decision:**
Define a total-ordered 16-stage enum: `SP -> POC -> IP -> A -> FP -> B -> EP -> CN -> RC -> GA -> LTS -> HF -> SS -> DEP -> AR -> EOL`.

- Stages implement `Ord` so that forward-only promotion can be enforced by `current < target`.
- Helper predicates: `is_pre_release()`, `is_production()`, `allows_flag_gated()`, `allows_compile_gated()`.
- Stage transitions are recorded in `stage_transitions` for full audit history.
- Transience class `T` flags must declare `retire_at_stage`; `valid_at_stage()` returns false past that stage.

**Consequences:**
- Flag promotion is forward-only and auditable.
- Tooling can query `is_pre_release()` to determine if a flag can be safely evaluated in production.
- The 16-stage model is Phenotype-specific and not interoperable with external feature flag systems without a translation layer.
- `HF` (Hotfix) and `SS` (Security Sensitive) stages allow flags to be re-activated post-GA without a full promotion cycle.

**Code locations:** `pheno-core/src/lib.rs` — `Stage`, `TransienceClass`, `FeatureFlag`

---

## ADR-005 | Clap CLI with Ratatui TUI as Dual Interface | Adopted

**Status:** Adopted

**Context:**
Operator workflows include both scripted/automated use (CI, shell scripts) and interactive exploration. A pure CLI serves automation; a TUI serves human explorers.

**Decision:**
- Primary interface: `clap`-based CLI with deeply nested subcommands (`flags create`, `config set`, `secrets get`, etc.).
- Secondary interface: `ratatui`-based TUI launched via `phenoctl tui`, operating against the same SQLite database.
- Both interfaces share `pheno-db` as the data layer; there is no duplication of business logic.

**Consequences:**
- Scripts can pipe `phenoctl` output without terminal interaction.
- Operators can explore the full config surface interactively with the TUI without memorizing subcommand syntax.
- TUI adds a `ratatui` + `crossterm` dependency to `pheno-cli`; FFI crates remain unaffected.
- The TUI must remain consistent with CLI semantics; divergence would be a bug.

**Code locations:** `pheno-cli/src/main.rs` (clap), `pheno-cli/src/tui.rs` (ratatui)

---

## ADR-006 | PyO3 and C-ABI FFI for Multi-Language Bindings | Adopted

**Status:** Adopted

**Context:**
Phenotype services are written in multiple languages. The configuration SDK must be consumable from Python (common for ML/agent tooling) and Go (common for infrastructure tooling) without each language reinventing the storage and encryption layers.

**Decision:**
- Python: `crates/pheno-ffi-python` uses PyO3 to expose `pheno-core` + `pheno-db` functions as a native Python extension module (`import pheno`).
- Go: `crates/pheno-ffi-go` exposes a C ABI via `#[no_mangle] pub extern "C"` functions and generates a `.h` header, consumed by Go via CGO.

**Consequences:**
- Python callers get Rust performance and type safety with zero runtime overhead.
- Go callers use CGO, which introduces build complexity and disables some Go tooling (e.g., `go test -race` on CGO code).
- FFI crates must not depend on `pheno-cli` (clap, ratatui) to keep the compilation unit small.
- API surface is intentionally minimal (get/set for config and flags); full trait implementations are not exposed via FFI.

**Code locations:** `crates/pheno-ffi-python/`, `crates/pheno-ffi-go/`
