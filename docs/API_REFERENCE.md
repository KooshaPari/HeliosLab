# HeliosLab API Reference

Source-grounded reference for the public API surface shipped by HeliosLab
(`~/CodeProjects/Phenotype/repos/HeliosLab`). All symbols listed here are
exported from the current working tree and verified against their declaring
files. Internal helpers are omitted unless they are part of a public type.

> Scope: HeliosLab is a TypeScript + Rust monorepo. The reference covers
> the four `packages/*` libraries, the `pheno-*` Rust crates, the
> `phenoctl` CLI, and the `apps/desktop` and `apps/runtime` entry
> points. Renderer-side utilities (`src/renderers/*`) and plugins
> (`test-plugin`, `webflow-plugin`) are out of scope for this reference;
> see [ARCHITECTURE.md](./ARCHITECTURE.md) for their place in the tree.

## Module map

| Layer | Path | Role |
| --- | --- | --- |
| Shared TS library | `packages/errors` | Typed `HeliosAppError` + canonical `ErrorCode` |
| Shared TS library | `packages/ids` | Typed ULID generator and validator |
| Shared TS library | `packages/logger` | Pino-backed structured logger |
| Shared TS library | `packages/types` | Workspace, lane, session, terminal interfaces |
| Shared TS library | `packages/runtime-core` | API client, config, ID generation, runtime protocol types |
| Rust core | `pheno-core` | `Error`, `ConfigEntry`, `ValueType`, audit types |
| Rust storage | `pheno-db` | `Database` (SQLite-backed) |
| Rust crypto | `pheno-crypto` | Secret encryption / key management |
| CLI binary | `pheno-cli` (`phenoctl`) | `clap`-driven configuration manager |
| FFI bridge | `crates/pheno-ffi-python` | PyO3 surface exposing `PhenoConfig` |
| FFI bridge | `crates/pheno-ffi-go` | cgo surface for Go callers |
| App | `apps/runtime` | Helios runtime package (`@helios/runtime`) |
| App | `apps/desktop` | ElectroBun desktop shell (`@helios/desktop`) |

---

## Shared TypeScript libraries

### `@helios/errors` — `packages/errors/src/index.ts`

Typed errors and canonical error codes used across Helios platform
modules.

```ts
export enum ErrorCode {
  // Generic
  INTERNAL_ERROR = "INTERNAL_ERROR",
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  UNAUTHENTICATED = "UNAUTHENTICATED",
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",
  CANCELLED = "CANCELLED",
  UNAVAILABLE = "UNAVAILABLE",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  TIMEOUT = "TIMEOUT",
  // Protocol / bus
  VALIDATION_ERROR = "VALIDATION_ERROR",
  METHOD_NOT_SUPPORTED = "METHOD_NOT_SUPPORTED",
  MISSING_CORRELATION_ID = "MISSING_CORRELATION_ID",
  // Terminal / lane / session
  TERMINAL_NOT_FOUND = "TERMINAL_NOT_FOUND",
  LANE_NOT_FOUND = "LANE_NOT_FOUND",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_NOT_ATTACHED = "SESSION_NOT_ATTACHED",
  TERMINAL_BINDING_INVALID = "TERMINAL_BINDING_INVALID",
}

export interface HeliosErrorDetails {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly fatal?: boolean;
}

export class HeliosAppError extends Error {
  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; fatal?: boolean },
  );
  toJSON(): HeliosErrorDetails;
}
```

Example:

```ts
import { ErrorCode, HeliosAppError } from "@helios/errors";

throw new HeliosAppError(ErrorCode.LANE_NOT_FOUND, "lane missing", {
  details: { laneId },
  fatal: false,
});
```

### `@helios/ids` — `packages/ids/src/index.ts`

Strict-format identifier generator and validator. IDs are typed
`<prefix>_<ulid>` with prefix drawn from `PREFIX_MAP`.

```ts
export type EntityType; // covers "lane" | "session" | "terminal" | etc.
export type ParsedId;
export type ValidationResult;

export const PREFIX_MAP: Readonly<Record<EntityType, string>>;
export const REVERSE_PREFIX_MAP: Readonly<Record<string, EntityType>>;

export function getPrefix(entityType: EntityType): string;
export function getEntityType(id: string): EntityType;
export function generateId(entityType: EntityType): string; // "<prefix>_<26-char ULID>"
export function generateCorrelationId(): string;
export function parseId(id: string): ParsedId;
export function validateId(id: string): ValidationResult;
```

The format enforced by `generateId` is
`/^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/`. Any generated ID that fails
this regex throws.

Example:

```ts
import { generateId, validateId } from "@helios/ids";

const laneId = generateId("lane"); // e.g. "la_01HZX9K6E3R8S7Q3Y1V2X4C5TB"
const ok = validateId(laneId).valid; // true
```

### `@helios/logger` — `packages/logger/src/index.ts`

Structured logger wrapping `pino@^9.6.0` with a frozen `Logger`
interface for compatibility with prior call sites.

```ts
export enum LogLevel {
  DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3, FATAL = 4,
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: Error | unknown;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown,
        context?: Record<string, unknown>): void;
  fatal(message: string, error?: Error | unknown,
        context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
  withLevel(level: LogLevel): Logger;
}
```

Usage:

```ts
import { LogLevel, type Logger } from "@helios/logger";

const log: Logger = createLogger({ level: LogLevel.INFO });
log.info("lane created", { laneId });
log.child({ workspaceId: "ws_01..." }).warn("lane throttled");
```

### `@helios/types` — `packages/types/src/index.ts`

Shared workspace / lane / session / terminal interfaces. All exported
fields are `readonly` to enforce immutable consumers.

```ts
export type WorkspaceState = "active" | "closed" | "deleted";

export interface ProjectBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly gitUrl?: string;
  readonly status: "active" | "stale";
  readonly boundAt: number;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly state: WorkspaceState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkspaceBinding {
  readonly workspace: Workspace;
  readonly projects: ProjectBinding[];
}

export interface Session {
  readonly id: string;
  readonly laneId: string;
  readonly terminalId: string;
  readonly workspaceId: string;
  readonly createdAt: number;
  readonly state: "active" | "detached" | "terminated";
}

export interface SessionConfig {
  readonly shell?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export type LaneState = "creating" | "active" | "closed" | "failed";

export interface Lane {
  readonly id: string;
  readonly workspaceId: string;
  readonly state: LaneState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface LaneBinding {
  readonly lane: Lane;
  readonly sessions: Session[];
}

export type TerminalState =
  | "spawning" | "running" | "throttled" | "closed";
```

### `@helios/runtime-core` — `packages/runtime-core/src/index.ts`

Cross-package extraction of the runtime protocol, lanes, sessions, and
integration layer. Version is pinned at `0.2.0` (`RUNTIME_CORE_VERSION`).

```ts
export const RUNTIME_CORE_VERSION = "0.2.0";

// API client — Anthropic Messages REST API wrapper
export type {
  AnthropicContentBlock,
  AnthropicErrorResponse,
  AnthropicHistoryEntry,
  AnthropicMessagesResponse,
  AnthropicTextBlock,
  SendMessagesOptions,
} from "./api-client.js";

export class AnthropicApiError extends Error {}
export function extractTextContent(
  blocks: AnthropicContentBlock[],
): string;
export function sendMessages(
  options: SendMessagesOptions,
): Promise<AnthropicMessagesResponse>;
export function toAnthropicHistory(
  messages: ReadonlyArray<unknown>,
): AnthropicHistoryEntry[];

// Config — env-var lookups
export function getAnthropicApiKey(): string;
export function getAnthropicBaseUrl(): string;
export function getDefaultModelId(): string;
export function isDev(): boolean;

// ID generation — thin wrappers over @helios/ids
export function generateConversationId(): string;
export function generateCorrelationId(): string;
export function generateLaneId(): string;
export function generateMessageId(): string;
export function generateSessionId(): string;
export function generateTerminalId(): string;
export function _resetMessageIdCounter(): void;

// Protocol envelopes + workspace types
export type {
  BaseEnvelope,
  CommandEnvelope,
  Conversation,
  EnvelopeType,
  EventEnvelope,
  Lane,
  LaneState,
  LocalBusEnvelope,
  Message,
  MessageMetadata,
  MessageRole,
  MessageStatus,
  ResponseEnvelope,
  Session,
  Terminal,
  TerminalState,
  Workspace,
} from "./types.js";
```

Example:

```ts
import {
  generateLaneId,
  sendMessages,
  getAnthropicApiKey,
} from "@helios/runtime-core";

const laneId = generateLaneId();
const res = await sendMessages({
  apiKey: getAnthropicApiKey(),
  model: "claude-...",
  messages: [{ role: "user", content: "Hello" }],
});
```

---

## Rust crates

### `pheno-core` — `pheno-core/src/lib.rs`

Shared types used by every other Rust crate and the FFI bridges.

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not found: {0}")] NotFound(String),
    #[error("database error: {0}")] Database(String),
    #[error("crypto error: {0}")] Crypto(String),
    #[error("invalid stage transition: {0}")] InvalidTransition(String),
    #[error("{0}")] Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub value_type: ValueType,
    pub namespace: String,
    pub updated_at: DateTime<Utc>,
    pub updated_by: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ValueType { String, Int, Float, Bool, Json }
```

`ValueType` also implements `fmt::Display` and the serde derives noted
above. Other audit / config records are declared in the same module;
treat them as internal until a stable re-export appears.

### `pheno-db` — `pheno-db/src/lib.rs`

SQLite-backed local storage. The single public entry point today is
`Database::open`, which is also the surface consumed by `pheno-cli`,
`pheno-ffi-python`, and `pheno-ffi-go`.

```rust
impl Database {
    pub fn open(path: &std::path::Path) -> pheno_core::Result<Database>;
    // CRUD over ConfigEntry and AuditRecord lives behind this handle.
}
```

### `pheno-crypto` — `pheno-crypto/src/lib.rs`

Cryptographic primitives and key management. The crate is consumed by
`pheno-cli secrets` and the FFI bridges; treat any symbols beyond the
re-exports surfaced through `phenoctl` as internal.

### `phenoctl` CLI — `pheno-cli/src/main.rs`

`phenoctl` is a `clap`-based binary (binary name `phenoctl`,
`[[bin]] path = "src/main.rs"`). Its subcommands map directly to the
configuration manager features described in the README.

Top-level arguments (`Cli`):

```rust
struct Cli {
    verbosity: Verbosity,        // from clap_ext
    config: ConfigArg,           // from clap_ext
    command: Commands,
    #[arg(long, global = true)]
    repo: Option<PathBuf>,       // repo root (default: CWD)
}
```

Subcommands (`Commands` enum):

| Command | Purpose |
| --- | --- |
| `flags <FlagCmd>` | Manage feature flags |
| `config <ConfigCmd>` | Manage `ConfigEntry` rows |
| `secrets <SecretCmd>` | Manage encrypted secrets |

Run `phenoctl --help` (and `phenoctl <subcommand> --help`) for the
authoritative per-subcommand flag list; the public surface is the
binary, not individual functions in `main.rs`.

### `pheno-ffi-python` — `crates/pheno-ffi-python/src/lib.rs`

PyO3 bridge that exposes the configuration store to Python. Builds
into a Python extension module consumed by the `pheno-cli`-driven
workflows.

```rust
#[pyclass]
struct PhenoConfig {
    db: Db,           // Mutex<Database>
    namespace: String,
}

#[pymethods]
impl PhenoConfig {
    #[new]
    #[pyo3(signature = (db_path, namespace = "default".to_string()))]
    fn new(db_path: String, namespace: String) -> PyResult<Self>;

    // get / set / list / delete / audit-trail methods wrap
    // pheno_core::ConfigEntry operations through Database::open.
}
```

`pheno_core::Error` is converted to `PyRuntimeError` via `to_pyerr`.
Python consumers should treat `PhenoConfig` as the entry point; the
inner `Database` handle is intentionally not re-exported.

### `pheno-ffi-go` — `crates/pheno-ffi-go/src/lib.rs`

cgo bridge for Go callers. Mirrors the Python FFI surface (`PhenoConfig`
plus the same configuration / audit operations). Build with
`cargo build` from the workspace root; the produced `c-archive` is
linked by the Go shim.

---

## Application entry points

### `@helios/runtime` — `apps/runtime/src/index.ts`

Core runtime package for `heliosApp`. Exports the foundational types
plus a lightweight integration runtime used by the test suite.

```ts
export const VERSION = "0.0.1" as const;

export interface HealthCheckResult {
  readonly ok: boolean;
  readonly timestamp: number;
  readonly uptimeMs: number;
}
export function healthCheck(): HealthCheckResult;

export type RuntimeAuditRecord = {
  recorded_at: string;
  type: "command" | "response" | "event";
  method?: string;
  topic?: string;
  correlation_id?: string;
  payload: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean } | null;
  envelope?: LocalBusEnvelope | Record<string, unknown>;
};

// Local bus and protocol
export const METHODS: Record<string, string>; // method → topic map
export class InMemoryLocalBus implements LocalBus { /* ... */ }
export function createBoundaryDispatcher(
  bus: LocalBus,
): BoundaryDispatcher;
export function handleRuntimeRequest(
  envelope: LocalBusEnvelope,
  registry: InMemorySessionRegistry,
  recovery: RecoveryRegistry,
  terminals: TerminalRegistry,
): Promise<LocalBusEnvelope>;

// Sessions and state
export class InMemorySessionRegistry { /* ... */ }
export class RecoveryRegistry { /* ... */ }
export class TerminalRegistry { /* ... */ }
export class LaneLifecycleService {
  // drives LaneRecord transitions through RuntimeState.
}
export type LaneRecord;
export type RuntimeState;
export type TerminalBuffer;
export type RecoveryBootstrapResult;
export type RecoveryMetadata;
export type WatchdogScanResult;

// Secrets redaction
export class RedactionEngine { /* ... */ }
export function getDefaultRules(): RedactionRule[];
```

Example boot:

```ts
import { healthCheck, VERSION } from "@helios/runtime";
const { ok, uptimeMs } = healthCheck();
console.log(`runtime v${VERSION} ok=${ok} uptime=${uptimeMs}ms`);
```

### `@helios/desktop` — `apps/desktop/src/index.ts`

ElectroBun desktop shell entry point. Imports
`{ healthCheck, VERSION, type HealthCheckResult }` from
`@helios/runtime` and re-uses them in `main()`.

```ts
export type BootDesktopInput = {
  bus?: LocalBus;
  initialSettings?: DesktopSettings;
};

export type RendererEngine = "bunny" | "helioslab";
export type DesktopSettings; // see ./settings.js
export const DEFAULT_SETTINGS: DesktopSettings;

export class EditorlessControlPlane {
  readonly store: ActiveContextStore;
  readonly runtimeClient: DesktopRuntimeClient;
  constructor(input?: BootDesktopInput);
  // Boots the desktop surface without the legacy editor plane.
}

export class DesktopRuntimeClient { /* talks to @helios/runtime */ }
export class ActiveContextStore { /* ... */ }
export type ActiveTab;
export const INITIAL_ACTIVE_CONTEXT_STATE: ActiveContextState;
export function selectActiveContext(state: ActiveContextState): ActiveTab;
export function switchRendererWithRollback(
  next: RendererEngine,
): Promise<void>;
export function buildAllTabSurfaces(): readonly TabSurface[];
export type TabSurface;
```

`main()` is invoked at module load to confirm cross-workspace imports
resolve; production code paths construct an `EditorlessControlPlane`
explicitly.

---

## Conventions and versioning

- **Library version pins**: `@helios/runtime-core` exports
  `RUNTIME_CORE_VERSION = "0.2.0"`; `@helios/runtime` exports
  `VERSION = "0.0.1"`. Consume these constants instead of hard-coding
  versions in callers.
- **ID format**: every runtime entity ID passes
  `/^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/`. Generate via
  `generateId(entityType)` (or the named convenience helpers), validate
  with `validateId`.
- **Error envelope**: throw `HeliosAppError` with a named `ErrorCode`
  on the boundary; `toJSON()` produces the wire shape
  `{ code, message, details?, fatal? }`.
- **Logging**: always go through the `Logger` interface exported from
  `@helios/logger`; child loggers inherit context via `child({...})`.
- **Rust errors**: surface failures as `pheno_core::Error` (or its
  `Result<T>` alias); FFI bridges translate at the language boundary.

For deeper context on how these layers compose, see
[ARCHITECTURE.md](./ARCHITECTURE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
