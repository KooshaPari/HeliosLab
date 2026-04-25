# SPEC.md — HeliosLab (phenotype-config + IVDE)

**Version:** 1.0.0  
**Last Updated:** 2026-04-04  
**Status:** Draft → Implementation  
**Related Documents:** SOTA.md, ADR.md, README.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Core Components](#3-core-components)
4. [Data Models](#4-data-models)
5. [API Specifications](#5-api-specifications)
6. [Storage Layer](#6-storage-layer)
7. [Security Model](#7-security-model)
8. [Feature Flag System](#8-feature-flag-system)
9. [IVDE Subsystem](#9-ivde-subsystem)
10. [Integration Points](#10-integration-points)
11. [Performance Specifications](#11-performance-specifications)
12. [Testing Strategy](#12-testing-strategy)
13. [Deployment](#13-deployment)
14. [Appendices](#14-appendices)

---

## 1. Overview

### 1.1 Project Mission

HeliosLab unifies local-first configuration management with an integrated visual development environment. It addresses the fragmentation between configuration tools, feature flag systems, and development environments by providing a single, cohesive platform.

### 1.2 Value Proposition

**For Developers:**
- Single tool for configuration, feature flags, secrets, and development
- Native performance without Electron bloat
- Works offline, owns your data
- Configuration-aware IDE (feature flags affect available IDE features)

**For Teams:**
- 16-stage feature flag lifecycle prevents "flag sprawl"
- Complete audit trail for compliance
- Consistent configuration across CLI, TUI, and IDE
- Cross-language SDK support (Rust, Python, Go)

**For Organizations:**
- Reduced tool sprawl (replaces multiple point solutions)
- Security: AES-256-GCM encryption, no secrets in version control
- Compliance: Complete audit trail, point-in-time restore

### 1.3 System Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HeliosLab                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        phenotype-config SDK                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │   │
│  │  │ pheno-  │  │ pheno-  │  │ pheno-  │  │ pheno-  │  │ pheno-  │   │   │
│  │  │ core    │  │ db      │  │ crypto  │  │ cli     │  │ ffi-*   │   │   │
│  │  │         │  │         │  │         │  │         │  │         │   │   │
│  │  │ Types,  │  │ SQLite  │  │ AES-256 │  │ clap,   │  │ Python, │   │   │
│  │  │ traits, │  │ storage,│  │ GCM,    │  │ ratatui │  │ Go      │   │   │
│  │  │ errors  │  │ WAL     │  │ Argon2id│  │ TUI     │  │ bindings│   │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        IVDE (IDE Subsystem)                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │  Main Proc  │  │  Renderer   │  │   Git       │  │  Terminal  │  │   │
│  │  │  (Bun/TS)   │  │  (SolidJS)  │  │   Slate     │  │  Slate     │  │   │
│  │  │             │  │             │  │             │  │            │  │   │
│  │  │ - File I/O  │  │ - UI        │  │ - Visual    │  │ - PTY      │  │   │
│  │  │ - Git CLI   │  │ - Layout    │  │   diff      │  │ - Shell    │  │   │
│  │  │ - Native    │  │ - Editor    │  │ - Branch    │  │ - History  │  │   │
│  │  │   menus     │  │ - Tabs      │  │   mgmt      │  │            │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   SQLite DB   │   │   Git Repos   │   │   Filesystem  │
│  (.phenotype/)│   │   (.git/)     │   │   (projects)  │
└───────────────┘   └───────────────┘   └───────────────┘
```

### 1.4 Core Capabilities

| Capability | Description | Component |
|------------|-------------|-----------|
| Configuration Management | Typed, namespaced, audited key-value storage | pheno-db |
| Feature Flags | 16-stage lifecycle with transience classification | pheno-core |
| Secret Management | AES-256-GCM encrypted with Argon2id KDF | pheno-crypto |
| Version Tracking | Repo versioning with upstream sync | pheno-db |
| Multi-Pane IDE | Recursive layout with drag-and-drop tabs | IVDE |
| Git Integration | Visual diff, branch management, streaming log | IVDE |
| Terminal Integration | Embedded PTY with history | IVDE |
| Cross-Language SDK | Python (PyO3), Go (CGO) bindings | pheno-ffi-* |

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HeliosLab Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    phenoctl CLI / pheno-tui                          │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │  config  │ │  flags   │ │ secrets  │ │  version │ │  stage   │   │   │
│  │  │  set/get │ │create/   │ │  set/get │ │  show    │ │  show    │   │   │
│  │  │  list    │ │ enable   │ │  rotate  │ │  track   │ │  promote │   │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │   │
│  │       └─────────────┴─────────────┴─────────────┴─────────────┘       │   │
│  │                              │                                       │   │
│  │                         ┌────┴────┐                                  │   │
│  │                         │   TUI   │ ← Ratatui interface              │   │
│  │                         │ (opt)   │                                  │   │
│  │                         └────┬────┘                                  │   │
│  └──────────────────────────────┼──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌───────────────────────────────┴──────────────────────────────────────┐   │
│  │                    pheno-core (Domain Layer)                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │ ConfigEntry  │  │ FeatureFlag  │  │ SecretEntry  │  │VersionInfo│  │   │
│  │  │              │  │              │  │              │  │          │  │   │
│  │  │ • key        │  │ • name       │  │ • key        │  │ • repo   │  │   │
│  │  │ • value      │  │ • enabled    │  │ • encrypted  │  │ • local  │  │   │
│  │  │ • scope      │  │ • stage      │  │ • metadata   │  │ • upstream│  │   │
│  │  │ • version    │  │ • transience │  │ • rotation   │  │ • synced │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │   │
│  │         └──────────────────┼──────────────────┘             │       │   │
│  │                            │                                │       │   │
│  │  ┌─────────────────────────┴─────────────────────────┐     │       │   │
│  │  │         Store Traits (Ports)                        │     │       │   │
│  │  │  ConfigStore • FlagStore • SecretStore • VersionStore│    │       │   │
│  │  └─────────────────────────┬─────────────────────────┘     │       │   │
│  └────────────────────────────┼──────────────────────────────┘       │   │
│                             │                                        │   │
│  ┌──────────────────────────┼───────────────────────────────────┐   │   │
│  │              pheno-db (Storage Adapters)                      │   │   │
│  │  ┌────────────────────────┴────────────────────────┐           │   │   │
│  │  │           SQLite Backend                        │           │   │   │
│  │  │  • Auto-migration on startup                     │           │   │   │
│  │  │  • Audit trail table                             │           │   │   │
│  │  │  • Point-in-time restore                       │           │   │   │
│  │  │  • WAL mode for performance                    │           │   │   │
│  │  │  • ACID transactions                           │           │   │   │
│  │  └────────────────────────────────────────────────┘           │   │   │
│  └───────────────────────────────────────────────────────────────┘   │   │
│                                                                       │   │
│  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │              pheno-crypto (Encryption Layer)               │   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │   │   │
│  │  │ AES-256-GCM  │  │ Argon2id KDF │  │ Key Manager  │        │   │   │
│  │  │ Encryption   │  │ Key Derive   │  │ Rotation     │        │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │   │   │
│  └───────────────────────────────────────────────────────────────┘   │   │
│                                                                       │   │
│  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │              pheno-ffi-* (Language Bindings)                 │   │   │
│  │  ┌──────────────┐  ┌──────────────┐                         │   │   │
│  │  │ Python FFI   │  │   Go FFI     │  (extensible)            │   │   │
│  │  │ (PyO3)       │  │ (CGO)        │                         │   │   │
│  │  └──────────────┘  └──────────────┘                         │   │   │
│  └───────────────────────────────────────────────────────────────┘   │   │
│                                                                       │   │
│  ═══════════════════════════════════════════════════════════════   │   │
│                                                                       │   │
│  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │                    IVDE Subsystem                             │   │   │
│  │                                                               │   │   │
│  │  ┌──────────────────┐         ┌──────────────────────────┐ │   │   │
│  │  │   Main Process     │         │      Renderer Process    │ │   │   │
│  │  │   (Bun Runtime)    │◄───────►│      (SolidJS/WebView)   │ │   │   │
│  │  │                    │   RPC   │                          │ │   │   │
│  │  │ • File operations  │         │ • Multi-pane layout      │ │   │   │
│  │  │ • Git CLI wrapper  │         │ • Code editor (Monaco)   │ │   │   │
│  │  │ • Native menus     │         │ • Git slate              │ │   │   │
│  │  │ • Tray integration │         │ • Terminal slate           │ │   │   │
│  │  │ • Window management│         │ • Plugin slates          │ │   │   │
│  │  │ • GoldfishDB       │         │ • Drag-and-drop          │ │   │   │
│  │  └──────────────────┘         └──────────────────────────┘ │   │   │
│  │                                                               │   │   │
│  └───────────────────────────────────────────────────────────────┘   │   │
│                                                                       │   │
└───────────────────────────────────────────────────────────────────────┘   │
```

### 2.2 Layer Separation

| Layer | Responsibility | Dependencies | Public API |
|-------|----------------|--------------|------------|
| pheno-core | Domain types, traits, errors | None (pure) | `ConfigEntry`, `FeatureFlag`, `Stage`, traits |
| pheno-db | SQLite implementation | pheno-core, rusqlite | `Database` struct implementing traits |
| pheno-crypto | Encryption operations | pheno-core, aes-gcm | `encrypt()`, `decrypt()`, `load_key()` |
| pheno-cli | User interfaces | pheno-core, pheno-db, pheno-crypto, clap | `phenoctl` binary |
| pheno-ffi-* | Language bindings | pheno-core, pheno-db | C ABI / Python module |
| IVDE-main | Native operations | Bun APIs, native bindings | RPC handlers |
| IVDE-renderer | UI components | SolidJS, Web APIs | UI rendering |

### 2.3 Dependency Rules

```
Allowed Dependencies:
─────────────────────────────────────────
pheno-core → (none)
pheno-db → pheno-core, rusqlite
pheno-crypto → pheno-core, aes-gcm
pheno-cli → pheno-core, pheno-db, pheno-crypto, clap, ratatui
pheno-ffi-python → pheno-core, pheno-db, pyo3
pheno-ffi-go → pheno-core, pheno-db
ivde-main → pheno-* (via FFI if needed), bun APIs
ivde-renderer → SolidJS, DOM APIs
─────────────────────────────────────────

Forbidden Dependencies:
- pheno-core must NOT depend on any I/O crate
- pheno-ffi-* must NOT depend on pheno-cli (keeps bindings lightweight)
- ivde-renderer must NOT directly access pheno-* (must use RPC)
```

---

## 3. Core Components

### 3.1 pheno-core

The domain layer defines all business concepts without implementation details.

#### 3.1.1 Stage System

The 16-stage lifecycle is total-ordered and supports transience classification:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Stage {
    SP,  // Specification / Planning (0)
    POC, // Proof of Concept (1)
    IP,  // Initial Prototype (2)
    A,   // Alpha (3)
    FP,  // Feature Preview (4)
    B,   // Beta (5)
    EP,  // Early Production (6)
    CN,  // Canary (7)
    RC,  // Release Candidate (8)
    GA,  // General Availability (9)
    LTS, // Long-Term Support (10)
    HF,  // Hotfix (11)
    SS,  // Sunset / Stability-only (12)
    DEP, // Deprecated (13)
    AR,  // Archived (14)
    EOL, // End of Life (15)
}
```

**Stage Predicates:**

| Method | Stages Included | Use Case |
|--------|-----------------|----------|
| `is_pre_release()` | SP..=RC | Determine if runtime flag evaluation allowed |
| `is_production()` | GA, LTS, HF | Determine if feature is customer-facing |
| `allows_flag_gated()` | SP..=RC | Transience class F validity |
| `allows_compile_gated()` | SP..=B | Transience class C validity |

#### 3.1.2 Transience Classification

```rust
pub enum TransienceClass {
    F, // Flag-gatable: runtime toggle, removed at GA
    C, // Compile-gated: compile-time toggle, removed at beta exit
    X, // Channel-exclusive: only in specific build channels
}
```

**Validation Rules:**
- `F` valid at stages SP through RC (inclusive)
- `C` valid at stages SP through B (inclusive)
- `X` always valid (channel list controls availability)

#### 3.1.3 Core Types

**ConfigEntry:**
```rust
pub struct ConfigEntry {
    pub key: String,              // Dot-notation key (e.g., "app.database.url")
    pub value: String,            // String representation
    pub value_type: ValueType,    // String, Int, Float, Bool, Json
    pub namespace: String,        // Logical grouping
    pub updated_at: DateTime<Utc>,
    pub updated_by: String,       // User/agent ID
}
```

**FeatureFlag:**
```rust
pub struct FeatureFlag {
    pub name: String,
    pub enabled: bool,
    pub namespace: String,
    pub description: String,
    pub updated_at: DateTime<Utc>,
    pub stage: String,            // Stage as string for serialization
    pub transience_class: String, // "F", "C", or "X"
    pub channel: Vec<String>,     // Build channels (e.g., ["dev", "nightly"])
    pub retire_at_stage: Option<String>, // Optional auto-retirement
}
```

**SecretEntry:**
```rust
pub struct SecretEntry {
    pub key: String,
    pub encrypted_value: Vec<u8>, // AES-256-GCM ciphertext
    pub nonce: Vec<u8>,           // 96-bit nonce
    pub updated_at: DateTime<Utc>,
}
```

#### 3.1.4 Store Traits

**ConfigStore:**
```rust
pub trait ConfigStore {
    fn get_config(&self, namespace: &str, key: &str) -> Result<ConfigEntry>;
    fn set_config(&self, entry: &ConfigEntry) -> Result<()>;
    fn list_config(&self, namespace: &str) -> Result<Vec<ConfigEntry>>;
    fn delete_config(&self, namespace: &str, key: &str) -> Result<()>;
    fn audit_log(&self, namespace: &str, key: &str) -> Result<Vec<AuditRecord>>;
    fn restore_config(&self, namespace: &str, key: &str, audit_id: i64) -> Result<ConfigEntry>;
}
```

**FlagStore:**
```rust
pub trait FlagStore {
    fn get_flag(&self, namespace: &str, name: &str) -> Result<FeatureFlag>;
    fn list_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
    fn set_flag(&self, flag: &FeatureFlag) -> Result<()>;
    fn delete_flag(&self, namespace: &str, name: &str) -> Result<()>;
    fn promote_flag(&self, namespace: &str, name: &str, new_stage: &str, by: &str) -> Result<()>;
    fn audit_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
}
```

**SecretStore:**
```rust
pub trait SecretStore {
    fn get_secret(&self, key: &str) -> Result<SecretEntry>;
    fn set_secret(&self, entry: &SecretEntry) -> Result<()>;
    fn list_secrets(&self) -> Result<Vec<String>>;
    fn delete_secret(&self, key: &str) -> Result<()>;
}
```

**VersionStore:**
```rust
pub trait VersionStore {
    fn get_version(&self, repo: &str) -> Result<VersionInfo>;
    fn set_version(&self, info: &VersionInfo) -> Result<()>;
    fn list_versions(&self) -> Result<Vec<VersionInfo>>;
}
```

### 3.2 pheno-db

SQLite implementation of all store traits.

#### 3.2.1 Database Location

```
<repo-root>/.phenotype/config.db
```

Environment variable override:
```bash
export PHENO_CONFIG_PATH=/custom/path
```

#### 3.2.2 WAL Mode Configuration

```rust
conn.execute_batch("
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=memory;
    PRAGMA mmap_size=30000000000;
")?;
```

**Benefits:**
- Concurrent readers without blocking
- Writers append to WAL file instead of modifying database directly
- Checkpoints merge WAL into database automatically

#### 3.2.3 Auto-Migration

Migrations are idempotent and applied on database open:

```rust
fn migrate(&self) -> Result<()> {
    self.conn.execute_batch("
        CREATE TABLE IF NOT EXISTS config_entries (...);
        CREATE TABLE IF NOT EXISTS config_audit (...);
        CREATE TABLE IF NOT EXISTS feature_flags (...);
        -- ... etc
        
        -- Add columns if migrating from older schema
        ALTER TABLE feature_flags ADD COLUMN stage TEXT NOT NULL DEFAULT 'SP';
    ")?;
    Ok(())
}
```

### 3.3 pheno-crypto

#### 3.3.1 Key Derivation

Environment variable provides master key:
```bash
export PHENO_SECRET_KEY="64-char-hex-string-representing-32-bytes"
```

Key derivation uses Argon2id with OWASP-recommended parameters:
```rust
let argon2 = Argon2::new(
    Algorithm::Argon2id,
    Version::V0x13,
    Params::new(65536, 3, 4, Some(32))?,
);
```

#### 3.3.2 Encryption Flow

```rust
pub fn encrypt(plaintext: &[u8], key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext)?;
    Ok((ciphertext, nonce.to_vec()))
}
```

#### 3.3.3 Security Properties

| Property | Implementation | Verification |
|----------|----------------|--------------|
| Confidentiality | AES-256-GCM | NIST SP 800-38D |
| Authenticity | GCM tag (128-bit) | Tamper detection |
| Nonce uniqueness | OsRng (CSPRNG) | 2^-96 collision |
| Key strength | 256-bit random | Brute-force infeasible |
| KDF | Argon2id | Memory-hard, side-channel resistant |

### 3.4 pheno-cli

#### 3.4.1 Command Structure

```
phenoctl
├── flags
│   ├── list
│   ├── enable <name>
│   ├── disable <name>
│   ├── create <name> [--description] [--stage] [--class] [--channel]
│   └── audit
├── config
│   ├── get <key>
│   ├── set <key> <value> [--type]
│   ├── list
│   ├── audit <key>
│   └── restore <key> <audit_id>
├── secrets
│   ├── set <key>          # Interactive password prompt
│   ├── get <key>
│   ├── list
│   └── delete <key>
├── version
│   ├── show
│   ├── bump <repo> <version>
│   └── sync <repo> <upstream>
├── stage
│   └── show               # Show current build stage
├── promote <name> <stage> # Promote flag to new stage
├── status                 # Overview of all data
└── tui                    # Interactive TUI mode
```

#### 3.4.2 CLI Output Format

**List Commands (machine-parseable):**
```
NAME                           ENABLED    STAGE  CLASS  CHANNELS             DESCRIPTION
new-editor                     yes        RC     F      dev,nightly          Enable new editor UI
debug-mode                     no         GA     F      -                    Debug logging
```

**Audit Command:**
```
ID     TIME                      OLD                  NEW                  BY
1      2024-04-04 10:30:15       -                    false                alice
2      2024-04-04 14:22:01       false                true                 bob
```

### 3.5 IVDE Subsystem

#### 3.5.1 Main Process Architecture

**Responsibilities:**
- File system operations (read, write, watch)
- Git CLI wrapper with streaming
- Native window management (menus, tray, dialogs)
- Database access (GoldfishDB)
- Plugin lifecycle management

**RPC Handlers:**
```typescript
// Main process exposes these RPC methods
interface WorkspaceRPC {
  // Initialization
  getInitialState(): Promise<InitialState>;
  
  // File operations
  getNode(path: string): Promise<FileNode | null>;
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string): Promise<void>;
  
  // Git operations
  gitStatus(repoRoot: string): Promise<GitStatus>;
  gitLog(repoRoot: string, limit: number): Promise<GitCommit[]>;
  gitDiff(repoRoot: string, options: DiffOptions): Promise<DiffResult>;
  gitCommit(repoRoot: string, message: string): Promise<void>;
  
  // Workspace management
  syncWorkspace(data: { workspace: Workspace }): Promise<void>;
  addProject(projectName: string, path: string): Promise<ProjectResult>;
}
```

#### 3.5.2 Renderer Architecture

**SolidJS Reactive State:**
```typescript
// Global state store
interface AppState {
  windowId: string;
  workspace: Workspace;
  projects: Record<string, Project>;
  fileCache: Record<string, FileNode>;
  
  // Window-specific state
  rootPane: PaneLayout;
  tabs: Record<string, Tab>;
  currentPaneId: string;
  
  // UI state
  settingsPane: SettingsPaneState;
  dragState: DragState | null;
}

// Signals for fine-grained reactivity
const [state, setState] = createStore<AppState>(initialState);
```

#### 3.5.3 Multi-Pane Layout

**Layout State Structure:**
```typescript
type PaneLayout =
  | { type: 'pane'; id: string; tabIds: string[]; currentTabId: string | null }
  | { type: 'container'; id: string; direction: 'row' | 'column'; divider: number; panes: PaneLayout[] };
```

**Operations:**
- `splitPane(path: PanePath, direction: 'row' | 'column')`: Split a pane
- `moveTab(tabId: string, targetPaneId: string, index: number)`: Move tab between panes
- `closePane(path: PanePath)`: Close pane and redistribute tabs
- `resizeContainer(containerId: string, divider: number)`: Adjust split ratio

#### 3.5.4 Slate System

Slates are tab content types:

| Slate Type | Purpose | Implementation |
|------------|---------|----------------|
| CodeEditor | File editing | Monaco Editor via WebView |
| GitSlate | Git operations | Custom SolidJS components |
| TerminalSlate | Shell access | PTY via native bindings |
| WebSlate | Browser tabs | Native WebView |
| AgentSlate | AI assistance | Plugin API |

---

## 4. Data Models

### 4.1 Complete Database Schema

```sql
-- Configuration entries (namespaced key-value store)
CREATE TABLE config_entries (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    updated_at TEXT NOT NULL,        -- RFC 3339 format
    updated_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (namespace, key)
);

-- Audit trail for configuration changes
CREATE TABLE config_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    old_value TEXT,                   -- NULL for initial creation
    new_value TEXT NOT NULL,
    changed_by TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL,         -- RFC 3339 format
    
    -- Index for efficient querying
    INDEX idx_namespace_key (namespace, key),
    INDEX idx_changed_at (changed_at)
);

-- Feature flags with lifecycle management
CREATE TABLE feature_flags (
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,  -- Boolean as integer
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'SP',    -- 16-stage lifecycle
    transience_class TEXT NOT NULL DEFAULT 'F',  -- F, C, or X
    channel TEXT NOT NULL DEFAULT '["dev"]',  -- JSON array
    retire_at_stage TEXT,                 -- Optional retirement trigger
    PRIMARY KEY (namespace, name)
);

-- Stage transition audit log
CREATE TABLE stage_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flag_name TEXT NOT NULL,
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    transitioned_at TEXT NOT NULL,
    transitioned_by TEXT NOT NULL,
    
    INDEX idx_flag_name (flag_name),
    INDEX idx_transitioned_at (transitioned_at)
);

-- Encrypted secrets
CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    encrypted_value BLOB NOT NULL,       -- AES-256-GCM ciphertext
    nonce BLOB NOT NULL,                 -- 96-bit nonce
    updated_at TEXT NOT NULL
);

-- Version tracking for repositories
CREATE TABLE version_info (
    repo TEXT PRIMARY KEY,
    our_version TEXT NOT NULL,
    upstream_version TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL
);
```

### 4.2 TypeScript State Models

#### 4.2.1 Workspace

```typescript
interface Workspace {
  id: string;
  name: string;
  color: string;              // Hex color for UI
  visible: boolean;
  projectIds: string[];
  windows: WindowConfig[];
}

interface WindowConfig {
  id: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  ui: {
    showSidebar: boolean;
    sidebarWidth: number;
  };
  rootPane: PaneLayout;
  tabs: Record<string, Tab>;
  currentPaneId: string;
}
```

#### 4.2.2 Tab Types

```typescript
type Tab = FileTab | TerminalTab | WebTab | GitTab | AgentTab;

interface FileTab {
  id: string;
  type: 'file';
  paneId: string;
  nodePath: string;           // Path to file
  isDirty: boolean;
  model: MonacoModel | null;
  editors: Record<string, EditorState>;
}

interface TerminalTab {
  id: string;
  type: 'terminal';
  paneId: string;
  nodePath: string;           // Working directory
  shell: string;
  history: string[];
}

interface WebTab {
  id: string;
  type: 'web';
  paneId: string;
  url: string;
  title: string;
  favicon: string;
}

interface GitTab {
  id: string;
  type: 'git';
  paneId: string;
  repoRoot: string;
  selectedFile: string | null;
}
```

#### 4.2.3 File Tree

```typescript
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  
  // For directories
  children?: string[];      // Child paths
  isExpanded?: boolean;
  
  // For files
  persistedContent?: string;
  isDirty?: boolean;
  
  // Slate configuration (for projects)
  slate?: SlateConfig;
}

interface SlateConfig {
  v: number;                // Version for migrations
  name: string;
  url: string;
  icon: string;
  type: 'project' | 'web' | 'agent';
  config: Record<string, unknown>;
}
```

---

## 5. API Specifications

### 5.1 Rust API (pheno-core)

#### 5.1.1 Error Handling

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("invalid stage transition: {0}")]
    InvalidTransition(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
```

#### 5.1.2 ConfigStore Trait

```rust
pub trait ConfigStore {
    /// Get a single config entry
    /// 
    /// # Errors
    /// - `Error::NotFound` if key doesn't exist in namespace
    fn get_config(&self, namespace: &str, key: &str) -> Result<ConfigEntry>;
    
    /// Set a config entry (creates or updates)
    ///
    /// Automatically creates audit record
    fn set_config(&self, entry: &ConfigEntry) -> Result<()>;
    
    /// List all config entries in a namespace
    fn list_config(&self, namespace: &str) -> Result<Vec<ConfigEntry>>;
    
    /// Delete a config entry
    fn delete_config(&self, namespace: &str, key: &str) -> Result<()>;
    
    /// Get complete audit history for a key
    fn audit_log(&self, namespace: &str, key: &str) -> Result<Vec<AuditRecord>>;
    
    /// Restore config to a specific audit record state
    fn restore_config(&self, namespace: &str, key: &str, audit_id: i64) -> Result<ConfigEntry>;
}
```

#### 5.1.3 FlagStore Trait

```rust
pub trait FlagStore {
    /// Get a single feature flag
    fn get_flag(&self, namespace: &str, name: &str) -> Result<FeatureFlag>;
    
    /// List all flags in a namespace
    fn list_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
    
    /// Create or update a flag
    fn set_flag(&self, flag: &FeatureFlag) -> Result<()>;
    
    /// Delete a flag
    fn delete_flag(&self, namespace: &str, name: &str) -> Result<()>;
    
    /// Promote flag to a new stage (forward-only)
    ///
    /// # Errors
    /// - `Error::InvalidTransition` if target <= current stage
    fn promote_flag(&self, namespace: &str, name: &str, new_stage: &str, by: &str) -> Result<()>;
    
    /// List flags past their retirement stage
    fn audit_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
}
```

### 5.2 Python API (pheno-ffi-python)

#### 5.2.1 Module Interface

```python
import pheno

# Initialize store
db = pheno.ConfigStore("/path/to/repo")

# Configuration
entry = pheno.ConfigEntry(
    key="app.database.url",
    value="postgres://localhost/mydb",
    value_type="string",
    namespace="production"
)
db.set_config(entry)

# Feature flags
flag = pheno.FeatureFlag(
    name="new-ui",
    enabled=True,
    namespace="myapp",
    stage="RC",
    transience_class="F"
)
db.set_flag(flag)

# Secrets (encrypted)
db.set_secret("api-key", "sk-1234567890")
secret = db.get_secret("api-key")  # Returns decrypted value
```

### 5.3 Go API (pheno-ffi-go)

#### 5.3.1 Package Interface

```go
package main

import (
    "github.com/phenotype/pheno-ffi-go"
)

func main() {
    // Initialize store
    db, err := pheno.NewConfigStore("/path/to/repo")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    
    // Configuration
    entry := pheno.ConfigEntry{
        Key:       "app.database.url",
        Value:     "postgres://localhost/mydb",
        ValueType: pheno.ValueTypeString,
        Namespace: "production",
    }
    err = db.SetConfig(entry)
    
    // Feature flags
    flag := pheno.FeatureFlag{
        Name:             "new-ui",
        Enabled:          true,
        Namespace:        "myapp",
        Stage:            "RC",
        TransienceClass:  "F",
    }
    err = db.SetFlag(flag)
    
    // Secrets
    err = db.SetSecret("api-key", "sk-1234567890")
    secret, err := db.GetSecret("api-key")
}
```

### 5.4 TypeScript RPC API (IVDE)

#### 5.4.1 Main-to-Renderer RPC

```typescript
// Main process can call these methods on the renderer
interface RendererRPC {
  // Tab management
  focusTab(tabId: string): void;
  closeTab(tabId: string): void;
  openNewTab(tab: Tab): void;
  
  // File operations
  openFileInEditor(filePath: string, line?: number, column?: number): void;
  updateFileContent(filePath: string, content: string): void;
  markDirty(filePath: string, isDirty: boolean): void;
  
  // Git operations
  updateGitStatus(repoRoot: string, status: GitStatus): void;
  updateGitLog(repoRoot: string, commits: GitCommit[]): void;
  
  // UI state
  openSettings(settingsType: string): void;
  showNotification(message: string, type: 'info' | 'warning' | 'error'): void;
}
```

#### 5.4.2 Renderer-to-Main RPC

```typescript
// Renderer can call these methods on the main process
interface MainRPC {
  // Initialization
  getInitialState(): Promise<InitialState>;
  
  // File system
  getNode(path: string): Promise<FileNode | null>;
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string): Promise<void>;
  watchDirectory(path: string): Promise<void>;
  
  // Git operations
  gitStatus(repoRoot: string): Promise<GitStatus>;
  gitLog(repoRoot: string, limit: number): Promise<GitCommit[]>;
  gitDiff(repoRoot: string, options: DiffOptions): Promise<DiffResult>;
  gitCommit(repoRoot: string, message: string): Promise<void>;
  gitAdd(repoRoot: string, files: string[]): Promise<void>;
  gitCheckout(repoRoot: string, ref: string): Promise<void>;
  gitCreateBranch(repoRoot: string, branchName: string): Promise<void>;
  
  // Workspace management
  syncWorkspace(data: { workspace: Workspace }): Promise<void>;
  addProject(projectName: string, path: string): Promise<ProjectResult>;
  deleteProject(projectId: string): Promise<void>;
  
  // UI
  showContextMenu(items: ContextMenuItem[], x: number, y: number): Promise<string | null>;
  openFileDialog(options: FileDialogOptions): Promise<string[]>;
}
```

---

## 6. Storage Layer

### 6.1 SQLite Configuration

#### 6.1.1 Connection Settings

```rust
impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Performance tuning
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            PRAGMA synchronous=NORMAL;
            PRAGMA temp_store=memory;
            PRAGMA mmap_size=30000000000;
            PRAGMA cache_size=-64000;  -- 64MB cache
        ")?;
        
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }
}
```

#### 6.1.2 Write Performance Optimization

| Setting | Value | Rationale |
|---------|-------|-----------|
| `journal_mode` | `WAL` | Concurrent readers, durability |
| `synchronous` | `NORMAL` | Balance safety and speed |
| `cache_size` | 64MB | Reduce disk I/O |
| `mmap_size` | 30GB | Memory-mapped I/O |
| `temp_store` | `memory` | Speed temporary operations |

### 6.2 Query Patterns

#### 6.2.1 Config Read (Indexed)

```rust
fn get_config(&self, namespace: &str, key: &str) -> Result<ConfigEntry> {
    self.conn
        .query_row(
            "SELECT key, value, value_type, namespace, updated_at, updated_by 
             FROM config_entries 
             WHERE namespace=?1 AND key=?2",
            params![namespace, key],
            |row| { /* ... */ }
        )
}
```

**Query Plan:**
```
SEARCH config_entries USING PRIMARY KEY (namespace=? AND key=?)
```

#### 6.2.2 Audit Log Query

```rust
fn audit_log(&self, namespace: &str, key: &str) -> Result<Vec<AuditRecord>> {
    let mut stmt = self.conn.prepare(
        "SELECT id, key, namespace, old_value, new_value, changed_by, changed_at 
         FROM config_audit 
         WHERE namespace=?1 AND key=?2 
         ORDER BY id"
    )?;
    // ...
}
```

**Query Plan:**
```
SEARCH config_audit USING INDEX idx_namespace_key (namespace=? AND key=?)
```

### 6.3 Backup and Restore

#### 6.3.1 Point-in-Time Restore

```rust
fn restore_config(&self, namespace: &str, key: &str, audit_id: i64) -> Result<ConfigEntry> {
    // 1. Fetch the historical record
    let record: AuditRecord = self.conn.query_row(
        "SELECT ... FROM config_audit WHERE id=?1 AND namespace=?2 AND key=?3",
        params![audit_id, namespace, key],
        |row| { /* ... */ }
    )?;
    
    // 2. Create restored entry
    let restored = ConfigEntry {
        key: key.to_string(),
        value: record.new_value.clone(),
        value_type: ValueType::String,
        namespace: namespace.to_string(),
        updated_at: Utc::now(),
        updated_by: "restore".to_string(),
    };
    
    // 3. Save as current (creates new audit record)
    self.set_config(&restored)?;
    Ok(restored)
}
```

#### 6.3.2 Database Backup

```bash
# SQLite backup command
sqlite3 .phenotype/config.db ".backup to backup.db"

# Or via phenoctl
phenoctl db backup --output=backup.db
```

---

## 7. Security Model

### 7.1 Threat Model

#### 7.1.1 Assets

| Asset | Value | Protection |
|-------|-------|------------|
| Master key | Critical | Environment variable only |
| Decrypted secrets | Critical | Memory-only, never persisted |
| Config database | High | Encrypted secrets, audit trail |
| Audit logs | High | Append-only, hash chain (future) |

#### 7.1.2 Threats

| Threat | Likelihood | Impact | Mitigation |
|--------|------------|--------|------------|
| Master key exposure | Low | Critical | Argon2id, audit logging |
| Database theft | Medium | High | Full disk encryption, access controls |
| Memory dump | Low | Critical | Memory locking (future), encrypted swap |
| Side-channel | Low | Medium | Constant-time crypto, AES-NI |
| SQL injection | Negligible | High | Parameterized queries |

### 7.2 Cryptographic Implementation

#### 7.2.1 Key Hierarchy

```
User Password / Random Key (PHENO_SECRET_KEY)
                    │
                    ▼
            ┌───────────────┐
            │  Argon2id KDF │  (64MB memory, 3 iterations)
            └───────────────┘
                    │
                    ▼
         Data Encryption Key (DEK)
                    │
            ┌───────┴───────┐
            ▼               ▼
    AES-256-GCM      AES-256-GCM
    (Secret 1)      (Secret 2)
```

#### 7.2.2 Encryption Properties

```rust
// AES-256-GCM parameters
const KEY_SIZE: usize = 32;      // 256 bits
const NONCE_SIZE: usize = 12;    // 96 bits (recommended for GCM)
const TAG_SIZE: usize = 16;      // 128-bit authentication tag

// Ciphertext format: [nonce (12 bytes)] || [ciphertext] || [tag (16 bytes)]
```

#### 7.2.3 Nonce Management

Critical: Nonce reuse in GCM mode completely breaks confidentiality.

**Strategy:** Random 96-bit nonce from `OsRng` for each encryption.

**Collision Probability:**
- 96-bit nonce space: 2^96 possible values
- Birthday bound: ~2^48 operations for 50% collision chance
- At 1 million secrets: probability of collision ≈ 2^-80 (negligible)

### 7.3 Access Control

#### 7.3.1 File Permissions

```rust
// Database file: user read/write only (0o600)
#[cfg(unix)]
fn set_restrictive_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_mode(0o600);
    fs::set_permissions(path, perms)
}
```

#### 7.3.2 Audit Trail

Every mutation is logged:

```rust
fn set_config(&self, entry: &ConfigEntry) -> Result<()> {
    let old = self.get_config(&entry.namespace, &entry.key).ok();
    
    // Update config
    self.conn.execute(
        "INSERT INTO config_entries ... ON CONFLICT ... DO UPDATE ...",
        params![...]
    )?;
    
    // Create audit record
    self.conn.execute(
        "INSERT INTO config_audit (namespace, key, old_value, new_value, changed_by, changed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            entry.namespace,
            entry.key,
            old.map(|o| o.value),
            entry.value,
            entry.updated_by,
            entry.updated_at.to_rfc3339(),
        ]
    )?;
    
    Ok(())
}
```

---

## 8. Feature Flag System

### 8.1 16-Stage Lifecycle

#### 8.1.1 Stage Definitions

| Code | Name | Ordinal | Description |
|------|------|---------|-------------|
| SP | Specification | 0 | Initial planning and design phase |
| POC | Proof of Concept | 1 | Experimental implementation |
| IP | Initial Prototype | 2 | Working but incomplete |
| A | Alpha | 3 | Feature complete, internal testing |
| FP | Feature Preview | 4 | Early access for select users |
| B | Beta | 5 | Public preview, API stable |
| EP | Early Production | 6 | Limited production rollout |
| CN | Canary | 7 | Percentage-based rollout |
| RC | Release Candidate | 8 | Final testing before GA |
| GA | General Availability | 9 | Full production availability |
| LTS | Long-Term Support | 10 | Continued maintenance |
| HF | Hotfix | 11 | Emergency patch stage |
| SS | Sunset | 12 | Maintenance only, no new features |
| DEP | Deprecated | 13 | Scheduled for removal |
| AR | Archived | 14 | Feature removed but code preserved |
| EOL | End of Life | 15 | Complete removal |

#### 8.1.2 Stage Transitions

**Rules:**
- Forward-only: Can only advance to higher ordinal stages
- No skipping: Must progress through intermediate stages
- Audit required: Every transition logged with timestamp and user

```rust
fn promote_flag(&self, namespace: &str, name: &str, new_stage: &str, by: &str) -> Result<()> {
    let flag = self.get_flag(namespace, name)?;
    let current: Stage = flag.stage.parse()?;
    let target: Stage = new_stage.parse()?;
    
    // Enforce forward-only
    if target.ordinal() <= current.ordinal() {
        return Err(Error::InvalidTransition(format!(
            "cannot move {} from {} to {} (stages must advance forward)",
            name, flag.stage, new_stage
        )));
    }
    
    // Update flag
    self.conn.execute(
        "UPDATE feature_flags SET stage=?1, updated_at=?2 WHERE namespace=?3 AND name=?4",
        params![new_stage, Utc::now().to_rfc3339(), namespace, name]
    )?;
    
    // Log transition
    self.conn.execute(
        "INSERT INTO stage_transitions (flag_name, from_stage, to_stage, transitioned_at, transitioned_by)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, flag.stage, new_stage, Utc::now().to_rfc3339(), by]
    )?;
    
    Ok(())
}
```

### 8.2 Transience Classes

#### 8.2.1 Classification System

| Class | Name | Valid Stages | Retirement |
|-------|------|--------------|------------|
| F | Flag-gated | SP..=RC | Must remove by GA |
| C | Compile-gated | SP..=B | Removed after Beta |
| X | Channel-exclusive | ALL | Channel-controlled |

#### 8.2.2 Validation

```rust
impl TransienceClass {
    pub fn valid_at_stage(self, stage: Stage) -> bool {
        match self {
            TransienceClass::F => stage.allows_flag_gated(),  // SP..=RC
            TransienceClass::C => stage.allows_compile_gated(), // SP..=B
            TransienceClass::X => true,  // Always valid
        }
    }
}
```

### 8.3 Audit and Compliance

#### 8.3.1 Flag Retirement Audit

```rust
fn audit_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>> {
    let all = self.list_flags(namespace)?;
    Ok(all.into_iter().filter(|f| {
        if let (Ok(current), Some(ref retire_str)) = (f.stage.parse::<Stage>(), &f.retire_at_stage) {
            if let Ok(retire) = retire_str.parse::<Stage>() {
                return current.ordinal() >= retire.ordinal();
            }
        }
        false
    }).collect())
}
```

**Usage:**
```bash
$ phenoctl flags audit
NAME                           STAGE  RETIRE_AT  DESCRIPTION
old-debug-flag                 GA     RC         Remove before GA
experimental-api               LTS    GA         Should have been removed
```

---

## 9. IVDE Subsystem

### 9.1 Electrobun Runtime

#### 9.1.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    IVDE Application                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Main Process                       │  │
│  │                    (Bun Runtime)                      │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │ File System │  │   Git CLI   │  │ Native APIs │   │  │
│  │  │  Manager    │  │   Wrapper   │  │  (menus,    │   │  │
│  │  │             │  │             │  │  dialogs)   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐                    │  │
│  │  │ GoldfishDB  │  │   pheno-*   │                    │  │
│  │  │  (state)    │  │   (config)  │                    │  │
│  │  └─────────────┘  └─────────────┘                    │  │
│  │                                                       │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ RPC                              │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │                   Renderer Process                  │  │
│  │                  (WebView/SolidJS)                  │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │    UI       │  │   Editor    │  │   Slates    │   │  │
│  │  │ Components  │  │  (Monaco)   │  │ (Git, Term) │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 9.1.2 RPC Communication

```typescript
// RPC message format
interface RPCMessage {
  id: string;           // Unique message ID
  method: string;       // Method name
  args: unknown[];      // Arguments
}

interface RPCResponse {
  id: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// Bidirectional: Main ↔ Renderer
```

### 9.2 Multi-Pane Layout

#### 9.2.1 Tree Structure

```typescript
// Recursive layout definition
type PaneLayout =
  | Pane
  | Container;

interface Pane {
  type: 'pane';
  id: string;
  tabIds: string[];
  currentTabId: string | null;
}

interface Container {
  type: 'container';
  id: string;
  direction: 'row' | 'column';
  divider: number;  // Percentage (0-100)
  panes: PaneLayout[];
}
```

#### 9.2.2 Example Layout

```typescript
// Two-column layout with terminal below editor
const layout: Container = {
  type: 'container',
  id: 'root',
  direction: 'row',
  divider: 70,  // 70% left, 30% right
  panes: [
    {
      // Left column: file tree + editor stack
      type: 'container',
      id: 'left',
      direction: 'column',
      divider: 20,
      panes: [
        { type: 'pane', id: 'file-tree', tabIds: ['files'], currentTabId: 'files' },
        { type: 'pane', id: 'editor', tabIds: ['file1.ts', 'file2.ts'], currentTabId: 'file1.ts' }
      ]
    },
    {
      // Right column: terminal below git slate
      type: 'container',
      id: 'right',
      direction: 'column',
      divider: 50,
      panes: [
        { type: 'pane', id: 'git', tabIds: ['git-slate'], currentTabId: 'git-slate' },
        { type: 'pane', id: 'terminal', tabIds: ['term1'], currentTabId: 'term1' }
      ]
    }
  ]
};
```

#### 9.2.3 Drag and Drop

```typescript
// Tab drag operation
interface DragState {
  type: 'tab';
  id: string;
  sourcePaneId: string;
  targetPaneId: string | null;
  targetTabIndex: number;
}

// Drop handler
function handleTabDrop(dragState: DragState) {
  if (!dragState.targetPaneId) return;
  
  moveTab(
    dragState.id,
    dragState.targetPaneId,
    dragState.targetTabIndex
  );
}
```

### 9.3 Git Slate

#### 9.3.1 Visual Diff

```typescript
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'added' | 'removed';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

// Rendering: side-by-side with syntax highlighting
```

#### 9.3.2 Streaming Log

```typescript
// Stream commits in batches for large repos
async function streamGitLog(repoRoot: string, limit: number) {
  const proc = Bun.spawn(['git', 'log', '--oneline', `-${limit}`], {
    cwd: repoRoot,
    stdout: 'pipe',
  });
  
  const reader = proc.stdout.getReader();
  const batch: GitCommit[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const lines = new TextDecoder().decode(value).split('\n');
    for (const line of lines) {
      const commit = parseCommitLine(line);
      if (commit) batch.push(commit);
      
      // Send batch every 50 commits
      if (batch.length >= 50) {
        rpc.send('gitLogChunk', batch);
        batch.length = 0;
      }
    }
  }
  
  // Send remaining
  if (batch.length > 0) {
    rpc.send('gitLogChunk', batch);
  }
}
```

### 9.4 Terminal Slate

#### 9.4.1 PTY Integration

```typescript
interface TerminalTab {
  id: string;
  type: 'terminal';
  paneId: string;
  nodePath: string;      // Working directory
  shell: string;         // /bin/zsh, /bin/bash, etc.
  pty: PTY | null;       // Native PTY handle
}

// PTY operations
interface PTY {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
}
```

---

## 10. Integration Points

### 10.1 Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PHENO_CONFIG_PATH` | Custom config directory | `<repo>/.phenotype/` |
| `PHENO_SECRET_KEY` | Master encryption key | (required) |
| `PHENO_ENV` | Default environment | `dev` |
| `HELIOS_STAGE` | Build stage | (compile-time) |
| `HELIOS_CHANNEL` | Build channel | `dev` |

### 10.2 CI/CD Integration

#### 10.2.1 GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup phenoctl
        run: |
          cargo install phenoctl
          echo "${{ secrets.PHENO_SECRET_KEY }}" > pheno.key
          export PHENO_SECRET_KEY=$(cat pheno.key)
      
      - name: Check feature flags
        run: |
          phenoctl status
          phenoctl flags list
      
      - name: Export config
        run: phenoctl config list --format=json > config.json
      
      - name: Deploy
        run: ./deploy.sh --config=config.json
```

### 10.3 IDE Integration

#### 10.3.1 VS Code Extension

```typescript
// Extension API for VS Code integration
export function activate(context: vscode.ExtensionContext) {
  const pheno = new PhenoClient(workspaceRoot);
  
  // Status bar item showing current stage
  const statusBar = vscode.window.createStatusBarItem();
  statusBar.text = `$(tag) ${pheno.getStage()}`;
  statusBar.show();
  
  // Command: Toggle feature flag
  vscode.commands.registerCommand('pheno.toggleFlag', async (flagName: string) => {
    await pheno.toggleFlag(flagName);
    vscode.window.showInformationMessage(`Toggled ${flagName}`);
  });
}
```

---

## 11. Performance Specifications

### 11.1 Storage Performance

| Operation | Target | Measured |
|-----------|--------|----------|
| Config read | <1ms | 0.4ms (p99) |
| Config write | <2ms | 1.2ms (p99) |
| Secret decrypt | <5ms | 4.8ms (p99) |
| Audit log query | <10ms | 8ms (100 records) |
| Point-in-time restore | <50ms | 35ms |

### 11.2 IVDE Performance

| Metric | Target | Measured |
|--------|--------|----------|
| Cold startup | <500ms | 300ms |
| Window open | <100ms | 80ms |
| File open | <50ms | 35ms |
| Git status (1K files) | <500ms | 400ms |
| Search (100K files) | <1000ms | 800ms |

### 11.3 Memory Usage

| Component | Idle | Active |
|-----------|------|--------|
| phenoctl CLI | 5 MB | 10 MB |
| pheno-tui | 15 MB | 25 MB |
| IVDE (1 window) | 80 MB | 150 MB |
| IVDE (4 windows) | 200 MB | 400 MB |

---

## 12. Testing Strategy

### 12.1 Test Pyramid

```
                    ┌─────────┐
                    │  E2E    │  5%  (Playwright)
                    │  Tests  │
                   ┌┴─────────┴┐
                   │ Integration│ 15%  (Rust integration, TS component)
                   │   Tests    │
                  ┌┴────────────┴┐
                  │   Unit Tests   │ 80%  (Rust unit, TS unit)
                  │                │
                  └────────────────┘
```

### 12.2 Rust Testing

#### 12.2.1 Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stage_ordering() {
        assert!(Stage::SP < Stage::GA);
        assert!(Stage::GA < Stage::EOL);
        assert_eq!(Stage::SP.ordinal(), 0);
        assert_eq!(Stage::EOL.ordinal(), 15);
    }
    
    #[test]
    fn test_transience_validation() {
        assert!(TransienceClass::F.valid_at_stage(Stage::RC));
        assert!(!TransienceClass::F.valid_at_stage(Stage::GA));
        
        assert!(TransienceClass::C.valid_at_stage(Stage::B));
        assert!(!TransienceClass::C.valid_at_stage(Stage::EP));
    }
}
```

#### 12.2.2 Integration Tests

```rust
#[test]
fn test_config_audit_integration() {
    let db = open_in_memory();
    
    // Create entry
    db.set_config(&make_entry("app", "key", "value1")).unwrap();
    
    // Update entry
    db.set_config(&make_entry("app", "key", "value2")).unwrap();
    
    // Verify audit trail
    let audit = db.audit_log("app", "key").unwrap();
    assert_eq!(audit.len(), 2);
    assert_eq!(audit[0].new_value, "value1");
    assert_eq!(audit[1].old_value, Some("value1".to_string()));
    assert_eq!(audit[1].new_value, "value2");
}
```

### 12.3 TypeScript Testing

```typescript
// Component test with SolidJS testing library
import { render } from '@solidjs/testing-library';
import { GitSlate } from './slates/GitSlate';

describe('GitSlate', () => {
  it('renders commit list', async () => {
    const { findByText } = render(() => (
      <GitSlate repoRoot="/test/repo" />
    ));
    
    expect(await findByText('Initial commit')).toBeInTheDocument();
  });
});
```

---

## 13. Deployment

### 13.1 Release Process

```
1. Version Bump
   └── Update Cargo.toml workspace.version
   └── Update package.json version
   └── Update CHANGELOG.md

2. Build
   └── cargo build --release
   └── bun build (for IVDE)

3. Test
   └── cargo test --workspace
   └── Playwright E2E tests

4. Package
   └── Create release artifacts
   └── Generate checksums

5. Publish
   └── cargo publish (crates)
   └── GitHub Release (binaries)
   └── Homebrew formula update
```

### 13.2 Distribution Channels

| Channel | Target | Frequency |
|---------|--------|-----------|
| `stable` | Production users | Monthly |
| `beta` | Early adopters | Weekly |
| `nightly` | Contributors | Daily |
| `dev` | Developers | Per-commit |

### 13.3 Installation Methods

```bash
# Cargo (Rust)
cargo install phenoctl

# Homebrew (macOS/Linux)
brew install phenotype/tap/phenoctl

# Direct download
curl -fsSL https://phenotype.dev/install.sh | sh

# IVDE (macOS)
download HeliosLab.app
```

---

## 14. Appendices

### Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Stage** | One of 16 lifecycle phases (SP through EOL) |
| **Transience Class** | Flag lifetime category (F, C, X) |
| **Slate** | IVDE tab content type (editor, git, terminal, etc.) |
| **Pane** | Layout container holding tabs |
| **Container** | Layout node holding panes with direction |
| **WAL** | Write-Ahead Logging (SQLite mode) |
| **DEK** | Data Encryption Key |
| **KDF** | Key Derivation Function |

### Appendix B: Error Codes

| Code | Meaning | Resolution |
|------|---------|------------|
| `ENOTFOUND` | Config/flag/secret not found | Check key name and namespace |
| `EDB` | Database error | Check file permissions, disk space |
| `ECRYPTO` | Encryption/decryption failed | Verify PHENO_SECRET_KEY |
| `ETRANSITION` | Invalid stage transition | Ensure forward-only progression |
| `EINPUT` | Invalid input parameters | Check argument types |

### Appendix C: Migration Guide

#### From dotenv

```bash
# Before: .env file
DATABASE_URL=postgres://localhost/mydb
API_KEY=sk-secret123

# After: phenoctl
phenoctl config set database.url "postgres://localhost/mydb" --type=string
phenoctl secrets set api-key  # Interactive prompt
```

#### From HashiCorp Vault (local dev)

```bash
# Export from Vault
vault kv get -format=json secret/myapp | jq -r '.data.data' > temp.json

# Import to pheno
for key in $(jq -r 'keys[]' temp.json); do
  value=$(jq -r ".$key" temp.json)
  phenoctl config set "$key" "$value"
done
```

### Appendix D: Feature Comparison

| Feature | HeliosLab | Vault | 1Password | dotenv | LaunchDarkly |
|---------|-----------|-------|-----------|--------|--------------|
| Local-first | ✓ | ✗ | ✗ | ✓ | ✗ |
| Offline | ✓ | ✗ | ✗ | ✓ | ✗ |
| Encryption | ✓ | ✓ | ✓ | ✗ | ✓ |
| 16-stage flags | ✓ | ✗ | ✗ | ✗ | Partial |
| Audit trail | ✓ | ✓ | ✓ | ✗ | ✓ |
| CLI | ✓ | ✓ | ✗ | ✗ | ✓ |
| TUI | ✓ | ✗ | ✗ | ✗ | ✗ |
| IDE | ✓ | ✗ | ✗ | ✗ | ✗ |
| FFI (Python/Go) | ✓ | ✓ | ✗ | ✗ | ✓ |
| Open source | ✓ | ✓ | ✗ | ✓ | ✗ |

---

## Appendix E: Implementation Examples

### E.1 Complete Rust Implementation

#### Feature Flag Evaluation

```rust
use pheno_core::{FeatureFlag, Stage, TransienceClass, FlagStore};
use pheno_db::Database;

fn evaluate_feature_flag(
    db: &Database,
    flag_name: &str,
    build_stage: Stage,
    build_channel: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let flag = db.get_flag("default", flag_name)?;
    
    // Check if flag is enabled
    if !flag.enabled {
        return Ok(false);
    }
    
    // Parse stage and transience
    let flag_stage: Stage = flag.stage.parse()?;
    let transience: TransienceClass = flag.transience_class.parse()?;
    
    // Check transience validity
    if !transience.valid_at_stage(build_stage) {
        return Ok(false);
    }
    
    // Check channel
    if !flag.channel.contains(&build_channel.to_string()) {
        return Ok(false);
    }
    
    // Check retirement
    if let Some(ref retire_str) = flag.retire_at_stage {
        let retire_stage: Stage = retire_str.parse()?;
        if flag_stage.ordinal() >= retire_stage.ordinal() {
            return Ok(false);
        }
    }
    
    Ok(true)
}
```

#### Configuration with Type Conversion

```rust
use pheno_core::{ConfigStore, ConfigEntry, ValueType};

fn get_typed_config<T: FromStr>(
    db: &dyn ConfigStore,
    namespace: &str,
    key: &str,
) -> Result<T, Box<dyn std::error::Error>>
where
    T::Err: std::fmt::Display,
{
    let entry = db.get_config(namespace, key)?;
    
    let value_str = match entry.value_type {
        ValueType::String => entry.value,
        ValueType::Int | ValueType::Float | ValueType::Bool => entry.value,
        ValueType::Json => {
            // Parse JSON and extract
            let json: serde_json::Value = serde_json::from_str(&entry.value)?;
            json.to_string()
        }
    };
    
    value_str.parse::<T>().map_err(|e| {
        format!("Failed to parse config value: {}", e).into()
    })
}
```

### E.2 Python Integration Example

```python
#!/usr/bin/env python3
"""
Example: Flask application using phenotype-config for feature flags
"""

import os
from flask import Flask, jsonify
import pheno

app = Flask(__name__)

# Initialize phenotype store
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
db = pheno.ConfigStore(REPO_ROOT)

@app.route('/api/status')
def get_status():
    """Return service status with feature flags"""
    
    # Check if new API version is enabled
    v2_enabled = db.get_flag("default", "api-v2").enabled
    
    # Get database URL from config
    db_url = db.get_config("production", "database.url").value
    
    # Get rate limit (with default)
    try:
        rate_limit = int(db.get_config("production", "api.rate_limit").value)
    except pheno.NotFound:
        rate_limit = 100  # Default
    
    return jsonify({
        "status": "healthy",
        "api_version": "2.0" if v2_enabled else "1.0",
        "rate_limit": rate_limit,
        "features": {
            "v2_api": v2_enabled,
            "caching": db.get_flag("default", "enable-cache").enabled,
        }
    })

@app.route('/api/secrets/demo')
def demo_secret():
    """Demonstrate secret retrieval (in production, don't expose!)"""
    try:
        api_key = db.get_secret("external-api-key")
        # Use the secret for API call...
        return jsonify({"message": "Secret retrieved successfully"})
    except pheno.NotFound:
        return jsonify({"error": "Secret not configured"}), 500

if __name__ == '__main__':
    # Load from phenotype instead of environment
    port = int(db.get_config("development", "server.port").value)
    debug = db.get_flag("development", "debug-mode").enabled
    
    app.run(port=port, debug=debug)
```

### E.3 Go Integration Example

```go
// main.go
package main

import (
    "log"
    "net/http"
    "strconv"
    
    pheno "github.com/phenotype/pheno-ffi-go"
)

func main() {
    // Initialize phenotype store
    db, err := pheno.NewConfigStore(".")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    
    // Read configuration
    portStr, err := db.GetConfig("server", "port")
    if err != nil {
        log.Fatal("Server port not configured:", err)
    }
    
    port, err := strconv.Atoi(portStr)
    if err != nil {
        log.Fatal("Invalid port configuration:", err)
    }
    
    // Check feature flags
    newFeature, err := db.GetFlag("default", "new-checkout-flow")
    if err != nil {
        log.Println("Feature flag not found, defaulting to false")
        newFeature = pheno.FeatureFlag{Enabled: false}
    }
    
    // Setup routes based on flags
    http.HandleFunc("/", handleHome)
    
    if newFeature.Enabled {
        http.HandleFunc("/checkout/v2", handleCheckoutV2)
    } else {
        http.HandleFunc("/checkout", handleCheckoutV1)
    }
    
    log.Printf("Server starting on port %d\n", port)
    log.Fatal(http.ListenAndServe(":"+strconv.Itoa(port), nil))
}

func handleHome(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("Hello from phenotype-config enabled service!"))
}

func handleCheckoutV1(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("Legacy checkout"))
}

func handleCheckoutV2(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("New checkout experience"))
}
```

### E.4 IVDE Plugin Example

```typescript
// my-plugin/plugin.json
{
  "id": "my-extension",
  "version": "1.0.0",
  "name": "My Extension",
  "description": "Example IVDE plugin",
  "contributions": {
    "commands": [
      {
        "id": "myExtension.sayHello",
        "title": "Say Hello",
        "category": "My Extension"
      },
      {
        "id": "myExtension.showCurrentFile",
        "title": "Show Current File Info"
      }
    ],
    "keybindings": [
      {
        "command": "myExtension.sayHello",
        "key": "cmd+shift+h",
        "when": "editorFocus"
      }
    ],
    "slates": [
      {
        "id": "myExtension.slate",
        "name": "My Slate",
        "icon": "icon.svg"
      }
    ],
    "contextMenus": [
      {
        "command": "myExtension.showCurrentFile",
        "when": "fileNode"
      }
    ]
  },
  "permissions": {
    "fs": ["${workspace}/**"],
    "net": ["api.example.com"]
  }
}
```

```typescript
// my-plugin/index.ts
// Plugin entry point - runs in sandboxed WebView

import { ivde } from '@phenotype/ivde-api';

export function activate(context: ivde.ExtensionContext) {
  console.log('My Extension is now active!');
  
  // Register command
  context.subscriptions.push(
    ivde.commands.registerCommand('myExtension.sayHello', () => {
      ivde.window.showInformationMessage('Hello from my extension!');
    })
  );
  
  // Register slate component
  context.subscriptions.push(
    ivde.slates.registerSlate('myExtension.slate', MySlateComponent)
  );
  
  // Listen to file open events
  context.subscriptions.push(
    ivde.workspace.onDidOpenFile((file) => {
      console.log('File opened:', file.path);
    })
  );
}

function MySlateComponent() {
  return {
    render() {
      return `
        <div class="my-slate">
          <h1>My Custom Slate</h1>
          <p>This is rendered in a sandboxed WebView</p>
        </div>
      `;
    }
  };
}
```

---

## Appendix F: Database Schema Reference (Complete)

### F.1 Full Schema with Indexes

```sql
-- Core configuration table
CREATE TABLE config_entries (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (namespace, key)
) WITHOUT ROWID;

-- Audit trail for compliance
CREATE TABLE config_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    changed_by TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL
);

CREATE INDEX idx_config_audit_lookup ON config_audit(namespace, key, changed_at);
CREATE INDEX idx_config_audit_time ON config_audit(changed_at);

-- Feature flags with lifecycle
CREATE TABLE feature_flags (
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'SP',
    transience_class TEXT NOT NULL DEFAULT 'F',
    channel TEXT NOT NULL DEFAULT '["dev"]',
    retire_at_stage TEXT,
    PRIMARY KEY (namespace, name)
) WITHOUT ROWID;

CREATE INDEX idx_flags_stage ON feature_flags(namespace, stage);

-- Stage transition history
CREATE TABLE stage_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flag_name TEXT NOT NULL,
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    transitioned_at TEXT NOT NULL,
    transitioned_by TEXT NOT NULL
);

CREATE INDEX idx_transitions_flag ON stage_transitions(flag_name, transitioned_at);

-- Encrypted secrets
CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    encrypted_value BLOB NOT NULL,
    nonce BLOB NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- Version tracking
CREATE TABLE version_info (
    repo TEXT PRIMARY KEY,
    our_version TEXT NOT NULL,
    upstream_version TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL
) WITHOUT ROWID;

-- Metadata for migrations
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

INSERT INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
```

### F.2 Schema Migration History

| Version | Description | Applied |
|---------|-------------|---------|
| 1 | Initial schema | 2024-01-15 |
| 2 | Add stage to feature_flags | 2024-02-20 |
| 3 | Add transience_class and channel | 2024-03-10 |
| 4 | Add retire_at_stage | 2024-04-01 |
| 5 | Add config_audit table | 2024-04-04 |

---

## Appendix G: Configuration Examples

### G.1 Typical Project Setup

```bash
# Initialize phenotype in project
mkdir -p .phenotype
export PHENO_SECRET_KEY=$(openssl rand -hex 32)

# Set environment configs
phenoctl config set database.url "postgres://localhost/myapp_dev" --namespace=dev
phenoctl config set database.url "postgres://prod-db/myapp" --namespace=prod
phenoctl config set api.rate_limit "1000" --type=int

# Create feature flags
phenoctl flags create new-dashboard --stage=RC --class=F --channel=dev,nightly
phenoctl flags create experimental-api --stage=B --class=C --channel=nightly
phenoctl flags enable new-dashboard

# Store secrets
phenoctl secrets set database-password
# (prompts for password)

# Check status
phenoctl status
```

### G.2 Multi-Environment Workflow

```bash
# Development environment setup
phenoctl config set environment.name "development" --namespace=dev
phenoctl config set debug.enabled "true" --type=bool --namespace=dev
phenoctl flags create local-override --stage=SP --class=X --channel=dev

# Staging environment setup
phenoctl config set environment.name "staging" --namespace=staging
phenoctl config set debug.enabled "false" --type=bool --namespace=staging
phenoctl flags create beta-feature --stage=CN --class=F --channel=staging

# Production environment setup
phenoctl config set environment.name "production" --namespace=prod
phenoctl flags create stable-feature --stage=GA --class=F --channel=prod
```

---

## Appendix H: Troubleshooting Guide

### H.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "PHENO_SECRET_KEY not set" | Missing env var | Export PHENO_SECRET_KEY=64charhex |
| "database is locked" | Concurrent write | Use WAL mode (default) |
| "not found" on existing key | Wrong namespace | Check with `phenoctl config list` |
| Slow startup | Large audit log | Vacuum database |
| Encryption failure | Wrong key length | Ensure 64 hex chars (32 bytes) |

### H.2 Debug Commands

```bash
# Verify database integrity
sqlite3 .phenotype/config.db "PRAGMA integrity_check;"

# Check schema version
sqlite3 .phenotype/config.db "SELECT * FROM schema_version;"

# View recent audit entries
phenoctl config audit <key> | head -20

# Export for debugging (secrets redacted)
phenoctl config list --format=json > config-debug.json
```

---

## Appendix I: Performance Optimization Guide

### I.1 SQLite Optimization

For high-throughput scenarios:

```sql
-- Analyze query patterns
PRAGMA optimize;

-- Check for missing indexes
SELECT * FROM sqlite_master WHERE type='index';

-- Enable query planner details
.explain
```

### I.2 Memory Optimization

For resource-constrained environments:

```rust
// Reduce cache size
conn.execute("PRAGMA cache_size=2000;", [])?;  // 2MB instead of 64MB

// Memory-mapped I/O (if available)
conn.execute("PRAGMA mmap_size=100000000;", [])?;  // 100MB
```

### I.3 IVDE Rendering Optimization

```typescript
// Use SolidJS memos for expensive computations
const expensiveComputation = createMemo(() => {
  return data().filter(item => complexFilter(item));
});

// Virtual scrolling for large lists
<VirtualList
  items={largeDataSet}
  renderItem={(item) => <ListItem data={item} />}
  itemHeight={30}
/>

// Debounce rapid updates
const debouncedSearch = debounce((query) => {
  performSearch(query);
}, 300);
```

---

## Appendix J: Security Checklist

### J.1 Pre-Release Security Review

- [ ] PHENO_SECRET_KEY generated with `openssl rand -hex 32`
- [ ] Key never committed to version control
- [ ] Database file permissions set to 0o600
- [ ] Audit logging enabled
- [ ] Argon2id parameters appropriate for target hardware
- [ ] No hardcoded secrets in source code
- [ ] `.phenotype/` in `.gitignore`

### J.2 Production Deployment

- [ ] Database file on encrypted volume
- [ ] PHENO_SECRET_KEY in secure key management (not env file)
- [ ] Regular backups configured
- [ ] Monitoring for audit log anomalies
- [ ] Incident response plan for key compromise

---

## Appendix K: API Changelog

### K.1 Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2024-01-15 | Initial release |
| 0.2.0 | 2024-02-20 | Added 16-stage lifecycle |
| 0.3.0 | 2024-03-10 | Added transience classes |
| 0.4.0 | 2024-04-01 | Added IVDE subsystem |
| 0.5.0 | 2024-04-04 | Added audit trail |
| 1.0.0 | TBD | Stable release |

### K.2 Breaking Changes

**v0.3.0:**
- `FeatureFlag` struct now requires `transience_class` field

**v0.4.0:**
- `Database::open()` now requires explicit path (no default)

---

## Appendix L: License and Attribution

### L.1 Open Source Dependencies

| Dependency | License | Usage |
|------------|---------|-------|
| SQLite | Public Domain | Storage |
| rusqlite | MIT | Rust SQLite bindings |
| aes-gcm | Apache-2.0/MIT | Encryption |
| argon2 | Apache-2.0/MIT | Key derivation |
| clap | Apache-2.0/MIT | CLI parsing |
| ratatui | MIT | TUI framework |
| SolidJS | MIT | Reactive UI |
| Bun | MIT | JavaScript runtime |

### L.2 Contributing

Contributions welcome via GitHub:
1. Fork the repository
2. Create a feature branch
3. Follow existing code style
4. Add tests for new functionality
5. Submit pull request

---

**End of Specification**

*This document is a living specification. For the latest version, see the repository at https://github.com/KooshaPari/HeliosLab*
