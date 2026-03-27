# Functional Requirements — phenotype-config (colab)

**Last Updated:** 2026-03-27
**Total FRs:** 34
**Implementation Status:** IN PROGRESS

Requirements are derived from: `pheno-core/src/lib.rs`, `pheno-db/src/lib.rs`, `pheno-crypto/src/lib.rs`, `pheno-cli/src/main.rs`, and `apps/runtime/src/protocol/`.

---

## FR-CFG: Configuration Management

### FR-CFG-001: Namespaced Key-Value Persistence
**SHALL** persist configuration entries with fields `(namespace, key, value, value_type, updated_at, updated_by)` in a SQLite table `config_entries` with `PRIMARY KEY (namespace, key)`.
**Traces to:** E1.1
**Code:** `pheno-db/src/lib.rs` — `Database::migrate()`, `config_entries` schema

### FR-CFG-002: Typed Values
**SHALL** support five value types: `string`, `int`, `float`, `bool`, `json`. The `ValueType` enum in `pheno-core` SHALL be serializable and SHALL implement `FromStr` for CLI parsing.
**Traces to:** E1.1
**Code:** `pheno-core/src/lib.rs` — `ValueType`

### FR-CFG-003: Config Set Command
**SHALL** expose `phenoctl config set <key> <value> [--type <type>] [--namespace <ns>]` writing a new or updated entry.
**Traces to:** E1.1
**Code:** `pheno-cli/src/main.rs` — `ConfigCmd`

### FR-CFG-004: Config Get Command
**SHALL** expose `phenoctl config get <key>` returning the current value and type; SHALL exit non-zero and print `not found: <key>` if missing.
**Traces to:** E1.1
**Code:** `pheno-cli/src/main.rs` — `ConfigCmd`

### FR-CFG-005: Config List Command
**SHALL** expose `phenoctl config list [--namespace <ns>]` returning all entries in a namespace in tabular form.
**Traces to:** E1.1
**Code:** `pheno-cli/src/main.rs` — `ConfigCmd`

### FR-CFG-006: Config Delete Command
**SHALL** expose `phenoctl config delete <key>` removing an entry and recording the deletion in `config_audit`.
**Traces to:** E1.1
**Code:** `pheno-cli/src/main.rs` — `ConfigCmd`

### FR-CFG-007: Audit Trail
**SHALL** record every config mutation in `config_audit` with columns `(namespace, key, old_value, new_value, changed_by, changed_at)`. The table SHALL be append-only (no DELETE or UPDATE on audit rows).
**Traces to:** E1.2
**Code:** `pheno-db/src/lib.rs` — `config_audit` schema

---

## FR-FLG: Feature Flag Lifecycle

### FR-FLG-001: Flag Create Command
**SHALL** expose `phenoctl flags create <name> [--description <text>]` creating a flag with initial stage `SP`, `enabled=false`, `transience_class=F`, and `channel=["dev"]`.
**Traces to:** E2.1
**Code:** `pheno-cli/src/main.rs` — `FlagCmd`

### FR-FLG-002: Flag Enable/Disable
**SHALL** expose `phenoctl flags enable <name>` and `phenoctl flags disable <name>` toggling `enabled` and updating `updated_at`.
**Traces to:** E2.1
**Code:** `pheno-cli/src/main.rs` — `FlagCmd`

### FR-FLG-003: Flag List and Get
**SHALL** expose `phenoctl flags list` (all flags, tabular) and `phenoctl flags get <name>` (full detail including stage history).
**Traces to:** E2.1
**Code:** `pheno-cli/src/main.rs` — `FlagCmd`

### FR-FLG-004: 16-Stage Lifecycle Enum
**SHALL** implement the `Stage` enum with exactly 16 variants in order: `SP, POC, IP, A, FP, B, EP, CN, RC, GA, LTS, HF, SS, DEP, AR, EOL`. Comparison SHALL use `Ord` so `SP < EOL`.
**Traces to:** E2.2
**Code:** `pheno-core/src/lib.rs` — `Stage`

### FR-FLG-005: Forward-Only Stage Promotion
**SHALL** reject promotion to a stage equal to or less than the current stage with `Error::InvalidTransition`. Only forward promotions are accepted.
**Traces to:** E2.2
**Code:** `pheno-core/src/lib.rs` — `Stage::Ord`, `pheno-db` — `promote_flag()`

### FR-FLG-006: Stage Transition Audit
**SHALL** persist every stage transition in `stage_transitions (flag_name, from_stage, to_stage, transitioned_at, transitioned_by)`.
**Traces to:** E2.2
**Code:** `pheno-db/src/lib.rs` — `stage_transitions` schema

### FR-FLG-007: Transience Class
**SHALL** enforce three transience classes: `F` (Permanent), `T` (Transient, requires `retire_at_stage`), `E` (Experimental). `TransienceClass::valid_at_stage()` SHALL return false if a Transient flag has passed its `retire_at_stage`.
**Traces to:** E2.3
**Code:** `pheno-core/src/lib.rs` — `TransienceClass`

### FR-FLG-008: Channel Gating
**SHALL** store `channel` as a JSON array (e.g. `["dev","beta"]`). Flag evaluation in non-matching channels SHALL return `false` without error.
**Traces to:** E2.3
**Code:** `pheno-db/src/lib.rs` — `feature_flags.channel`

### FR-FLG-009: Promote Command
**SHALL** expose `phenoctl promote <name> <target_stage>` and `phenoctl flags promote <name> <stage>` validating and executing stage advancement.
**Traces to:** E2.2
**Code:** `pheno-cli/src/main.rs` — `Commands::Promote`

### FR-FLG-010: Stage List Command
**SHALL** expose `phenoctl stage list` grouping all flags by their current stage.
**Traces to:** E2.2
**Code:** `pheno-cli/src/main.rs` — `StageCmd`

---

## FR-SEC: Secrets Management

### FR-SEC-001: AES-256-GCM Encryption
**SHALL** encrypt secret values using AES-256-GCM with a randomly generated 96-bit nonce per write. Ciphertext and nonce SHALL be stored separately in the database.
**Traces to:** E3.1
**Code:** `pheno-crypto/src/lib.rs` — `encrypt()`, `decrypt()`

### FR-SEC-002: Key Loading from Environment
**SHALL** load the encryption key from `PHENO_SECRET_KEY` (hex-encoded 32-byte key). If the env var is absent, SHALL fail with `Error::Crypto("PHENO_SECRET_KEY not set")` — no silent fallback.
**Traces to:** E3.1
**Code:** `pheno-crypto/src/lib.rs` — `load_key_from_env()`

### FR-SEC-003: Secrets CLI Commands
**SHALL** expose: `secrets set <name>` (reads from stdin), `secrets get <name>` (decrypts to stdout), `secrets list` (names only, no values), `secrets delete <name>`.
**Traces to:** E3.1
**Code:** `pheno-cli/src/main.rs` — `SecretCmd`

### FR-SEC-004: No Plaintext Persistence
**SHALL** never write plaintext secret values to the database. The `secret_value` column SHALL contain only ciphertext bytes (base64 or hex encoded).
**Traces to:** E3.1

---

## FR-VER: Version Tracking

### FR-VER-001: Version Record
**SHALL** store version records with fields `(semver, stage, channel, recorded_at)`. Records are append-only; each call to `version set` inserts a new row.
**Traces to:** E4.1
**Code:** `pheno-core/src/lib.rs` — `VersionInfo`

### FR-VER-002: Version CLI Commands
**SHALL** expose `version show` (current record) and `version set --semver <x.y.z> --stage <stage> --channel <ch>`.
**Traces to:** E4.1
**Code:** `pheno-cli/src/main.rs` — `VersionCmd`

---

## FR-TUI: Interactive Terminal UI

### FR-TUI-001: TUI Launch
**SHALL** launch via `phenoctl tui` using ratatui. The TUI SHALL operate against the same SQLite database as the CLI.
**Traces to:** E5.1
**Code:** `pheno-cli/src/tui.rs`

### FR-TUI-002: TUI Panels
**SHALL** provide navigable panels for Config, Flags, Secrets, and Version. Keyboard bindings: arrows to navigate, Enter to select/edit, Escape/q to quit.
**Traces to:** E5.1
**Code:** `pheno-cli/src/tui.rs`

---

## FR-FFI: Language Bindings

### FR-FFI-001: Python FFI via PyO3
**SHALL** expose `get_config`, `set_config`, `get_flag`, and `set_flag` as Python functions via `crates/pheno-ffi-python` (PyO3). Module SHALL be importable as `import pheno`.
**Traces to:** E6.1
**Code:** `crates/pheno-ffi-python/`

### FR-FFI-002: Go FFI via C ABI
**SHALL** expose config get/set and flag get/enable via `crates/pheno-ffi-go` as a C ABI. The crate SHALL generate a `.h` header file and compile without CGO warnings under `cargo build --release`.
**Traces to:** E6.2
**Code:** `crates/pheno-ffi-go/`

---

## FR-DB: Database Infrastructure

### FR-DB-001: WAL Mode and Foreign Keys
**SHALL** open SQLite with `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` before any table operations.
**Traces to:** E1.1
**Code:** `pheno-db/src/lib.rs` — `Database::open()`

### FR-DB-002: Auto-Migration on Open
**SHALL** run schema migrations idempotently (`CREATE TABLE IF NOT EXISTS`) on every `Database::open()` call so that new installations initialize automatically without a separate migration command.
**Traces to:** E1.1
**Code:** `pheno-db/src/lib.rs` — `Database::migrate()`

---

## FR-PROTO: Local Bus Protocol (apps/runtime)

### FR-PROTO-001: Topic Registry
**SHALL** define a canonical topic registry (`TOPICS` constant in `apps/runtime/src/protocol/topics.ts`) listing all pub/sub event topic strings: `workspace.opened`, `project.ready`, `session.created`, `session.attached`, `session.attach.started`, `session.attach.failed`, `session.restore.started`, `session.restore.completed`, `session.terminated`, `terminal.spawn.started`, `terminal.spawned`, `terminal.spawn.failed`, `terminal.output`, `terminal.state.changed`, `renderer.switch.started`, `renderer.switch.succeeded`.
**Traces to:** E4.1
**Code:** `apps/runtime/src/protocol/topics.ts`

### FR-PROTO-002: Method Registry
**SHALL** define a canonical method registry listing all command methods in `apps/runtime/src/protocol/methods.ts`; method names SHALL follow the `<entity>.<verb>` naming convention.
**Traces to:** E4.1
**Code:** `apps/runtime/src/protocol/methods.ts`

### FR-PROTO-003: EventEnvelope Type
**SHALL** define `EventEnvelope` TypeScript interface with fields: `id` (string), `correlation_id` (string | undefined), `type` (literal `"event"`), `ts` (number), `topic` (string), `payload` (unknown); the type SHALL be importable from the protocol module.
**Traces to:** E4.1
**Code:** `apps/runtime/src/protocol/topics.ts`

### FR-PROTO-004: Ordered Subscriber Delivery
**SHALL** implement the `TopicRegistry` such that subscribers for a given topic receive events in the order they were registered; deterministic delivery order SHALL be maintained across concurrent event dispatches.
**Traces to:** E4.1
**Code:** `apps/runtime/src/protocol/topics.ts`

### FR-PROTO-005: Go FFI Protocol Bridge
**SHALL** expose the `pheno-ffi-go` crate (`crates/pheno-ffi-go`) as a C ABI that the Go runtime layer can link against; the generated header SHALL include at minimum `pheno_config_get`, `pheno_config_set`, `pheno_flag_get`, `pheno_flag_enable`.
**Traces to:** E6.2
**Code:** `crates/pheno-ffi-go/`

### FR-PROTO-006: Python FFI Protocol Bridge
**SHALL** expose the `pheno-ffi-python` crate (`crates/pheno-ffi-python`) as a PyO3 extension module importable as `import pheno`; all functions SHALL release the GIL during SQLite I/O.
**Traces to:** E6.1
**Code:** `crates/pheno-ffi-python/`
