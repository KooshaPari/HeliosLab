# SPEC.md - phenotype-config (HeliosLab)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│              phenotype-config Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    phenoctl CLI                          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │
│  │  │  config  │ │  flags   │ │ secrets  │ │ version  │    │  │
│  │  │  set/get │ │create/   │ │  set/get │ │  show    │    │  │
│  │  │  list    │ │ enable   │ │  rotate  │ │  track   │    │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘    │  │
│  │       └─────────────┴─────────────┴─────────────┘        │  │
│  │                         │                                │  │
│  │                    ┌────┴────┐                           │  │
│  │                    │   TUI   │ ← Ratatui interface       │  │
│  │                    │ (opt)   │                           │  │
│  │                    └────┬────┘                           │  │
│  └─────────────────────────┼───────────────────────────────┘  │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐  │
│  │              pheno-core (Domain Layer)                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │  │
│  │  │ ConfigEntry  │  │ FeatureFlag  │  │ SecretEntry  │ │  │
│  │  │              │  │              │  │              │ │  │
│  │  │ • key        │  │ • name       │  │ • key        │ │  │
│  │  │ • value      │  │ • enabled    │  │ • encrypted  │ │  │
│  │  │ • scope      │  │ • rules      │  │ • metadata   │ │  │
│  │  │ • version    │  │ • audit      │  │ • rotation   │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │  │
│  │         └──────────────────┼──────────────────┘         │  │
│  │                            │                            │  │
│  │  ┌─────────────────────────┴─────────────────────────┐  │  │
│  │  │         Store Traits (Ports)                      │  │  │
│  │  │  ConfigStore • FlagStore • SecretStore           │  │  │
│  │  └─────────────────────────┬─────────────────────────┘  │  │
│  └────────────────────────────┼────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────┼────────────────────────────┐   │
│  │              pheno-db (Storage Adapters)                │   │
│  │  ┌────────────────────────┴────────────────────────┐   │   │
│  │  │           SQLite Backend                        │   │   │
│  │  │  • Auto-migration on startup                     │   │   │
│  │  │  • Audit trail table                             │   │   │
│  │  │  • Point-in-time restore                       │   │   │
│  │  │  • ACID transactions                           │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              pheno-crypto (Encryption)               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │ AES-256-GCM  │  │ Argon2 KDF   │  │ Key Mgmt     │ │   │
│  │  │ Encryption   │  │ Key Derive   │  │ Rotation     │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              pheno-ffi-* (Language Bindings)          │   │
│  │  ┌──────────────┐  ┌──────────────┐                 │   │
│  │  │ Python FFI   │  │   Go FFI     │  (extensible)    │   │
│  │  │ (PyO3)       │  │ (CGO)        │                 │   │
│  │  └──────────────┘  └──────────────┘                 │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. pheno-core - Domain Layer
- **ConfigEntry**: Key-value configuration with scoping
  - Global, project, user, or environment scope
  - Version tracking and history
  - Type-safe value storage
- **FeatureFlag**: Boolean flags with rules and rollout
  - Percentage-based rollout
  - User/tenant targeting
  - A/B testing support
- **SecretEntry**: Encrypted sensitive values
  - AES-256-GCM encryption
  - Automatic key rotation
  - Metadata tracking (created, rotated, expires)
- **VersionInfo**: Semantic versioning and rollout state
  - Current version tracking
  - Rollout progress monitoring
  - Deployment history

### 2. pheno-db - Storage Layer
- **SQLite Backend**: Default local-first storage
  - Rusqlite for Rust integration
  - Connection pooling
  - WAL mode for performance
- **Auto-migration**: Schema versioning and updates
  - Diesel or custom migration system
  - Versioned schema files
  - Rollback capability
- **Audit Trail**: Complete change history
  - Who, what, when for every change
  - Immutable log entries
  - Queryable history
- **Point-in-time Restore**: Time travel for config
  - Snapshot-based recovery
  - Selective restore
  - Conflict resolution

### 3. pheno-crypto - Encryption Layer
- **AES-256-GCM**: Industry-standard encryption
  - Authenticated encryption
  - Nonce management
  - Tag verification
- **Argon2**: Secure key derivation
  - Memory-hard hashing
  - Configurable parameters
  - Side-channel resistance
- **Key Management**: Secure key handling
  - Environment-derived keys
  - Key rotation without re-encryption
  - Hardware security module support (future)

### 4. phenoctl - CLI Interface
- **Config Commands**: CRUD operations for settings
  - `phenoctl config set <key> <value>`
  - `phenoctl config get <key>`
  - `phenoctl config list [--scope]`
- **Flag Commands**: Feature flag lifecycle
  - `phenoctl flags create <name>`
  - `phenoctl flags enable|disable <name>`
  - `phenoctl flags rollout <name> <percentage>`
- **Secret Commands**: Encrypted value management
  - `phenoctl secrets set <key>` (interactive)
  - `phenoctl secrets get <key>`
  - `phenoctl secrets rotate <key>`
- **Version Commands**: Version tracking
  - `phenoctl version show`
  - `phenoctl version history`
- **TUI Mode**: Terminal UI (optional)
  - `phenoctl tui` for interactive management
  - Ratatui-based interface
  - Real-time updates

### 5. pheno-ffi-* - Language Bindings
- **Python (pheno-ffi-python)**: PyO3-based bindings
  - Pip-installable package
  - Pythonic API wrapper
  - Async support
- **Go (pheno-ffi-go)**: CGO bindings
  - Go module distribution
  - Idiomatic Go API
  - Context support

## Data Models

### ConfigEntry
```rust
pub struct ConfigEntry {
    pub id: Uuid,
    pub key: String,              // Dot-notation key (e.g., "app.database.url")
    pub value: ConfigValue,       // Typed value (String, Int, Bool, Json)
    pub scope: ConfigScope,       // Global, Project, User, Environment
    pub project_id: Option<String>,
    pub environment: Option<String>, // dev, staging, prod
    pub version: u32,             // Incremented on each change
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: String,       // User/agent ID
}

pub enum ConfigValue {
    String(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Json(serde_json::Value),
}

pub enum ConfigScope {
    Global,      // Across all projects
    Project,     // Project-specific
    User,        // User-specific override
    Environment, // Environment-specific
}
```

### FeatureFlag
```rust
pub struct FeatureFlag {
    pub id: Uuid,
    pub name: String,             // Unique identifier
    pub description: Option<String>,
    pub enabled: bool,            // Master switch
    pub rollout_percentage: u8,   // 0-100
    pub rules: Vec<FlagRule>,     // Targeting rules
    pub audit_log: Vec<FlagChange>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct FlagRule {
    pub condition: RuleCondition,
    pub action: RuleAction,       // Enable, Disable, Percentage
}

pub enum RuleCondition {
    UserIdIn(Vec<String>),
    TenantId(String),
    Environment(String),
    Custom(String),              // JSONLogic or similar
}
```

### SecretEntry
```rust
pub struct SecretEntry {
    pub id: Uuid,
    pub key: String,              // Secret identifier
    pub encrypted_value: Vec<u8>, // AES-256-GCM encrypted
    pub nonce: Vec<u8>,           // Encryption nonce
    pub metadata: SecretMetadata,
    pub version: u32,             // Rotation counter
}

pub struct SecretMetadata {
    pub created_at: DateTime<Utc>,
    pub rotated_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>, // Optional TTL
    pub created_by: String,
    pub last_rotated_by: Option<String>,
}
```

### VersionInfo
```rust
pub struct VersionInfo {
    pub project_name: String,
    pub current_version: semver::Version,
    pub rollout_state: RolloutState,
    pub deployment_history: Vec<DeploymentRecord>,
}

pub enum RolloutState {
    Pending,      // Awaiting deployment
    InProgress(u8), // Percentage rolled out
    Complete,     // Fully deployed
    RolledBack,   // Reverted to previous
}
```

## Store Traits (Ports)

```rust
#[async_trait]
pub trait ConfigStore: Send + Sync {
    async fn get(&self, key: &str, scope: ConfigScope) -> Result<Option<ConfigEntry>>;
    async fn set(&self, entry: ConfigEntry) -> Result<ConfigEntry>;
    async fn list(&self, scope: Option<ConfigScope>) -> Result<Vec<ConfigEntry>>;
    async fn delete(&self, id: Uuid) -> Result<()>;
    async fn history(&self, key: &str) -> Result<Vec<ConfigEntry>>;
}

#[async_trait]
pub trait FlagStore: Send + Sync {
    async fn get(&self, name: &str) -> Result<Option<FeatureFlag>>;
    async fn create(&self, flag: FeatureFlag) -> Result<FeatureFlag>;
    async fn update(&self, flag: FeatureFlag) -> Result<FeatureFlag>;
    async fn list(&self) -> Result<Vec<FeatureFlag>>;
    async fn evaluate(&self, name: &str, context: EvalContext) -> Result<bool>;
}

#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<SecretEntry>>;
    async fn set(&self, key: &str, value: &str) -> Result<SecretEntry>;
    async fn rotate(&self, key: &str) -> Result<SecretEntry>;
    async fn delete(&self, key: &str) -> Result<()>;
}
```

## Performance Specifications

### Storage
- **SQLite Performance**: 10,000+ ops/sec on SSD
- **Connection Pool**: 10 connections default
- **Cache**: LRU cache for hot configs (optional Redis)
- **Audit Log**: Partitioned by month for query performance

### Encryption
- **Encryption Speed**: <1ms per secret
- **Key Derivation**: ~100ms (Argon2 with safe params)
- **Batch Operations**: Support for bulk secret operations

### CLI
- **Startup Time**: <100ms
- **Command Latency**: <50ms for local operations
- **TUI Refresh**: 60fps, <16ms per frame

## Security Model

### Encryption
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: Argon2id with memory-hard parameters
- **Key Source**: Environment variable or keyring
- **Rotation**: Transparent re-encryption on rotation

### Audit Trail
- **Immutability**: Append-only log
- **Integrity**: Hash chain for tamper detection
- **Retention**: Configurable (default: 90 days)

### Access Control
- **Scopes**: Configurable visibility boundaries
- **User Tracking**: Every change attributed
- **Secret Isolation**: Separate encryption per secret

## Integration Points

### Environment Variables
- `PHENO_CONFIG_PATH`: Custom config directory
- `PHENO_MASTER_KEY`: Encryption key derivation input
- `PHENO_ENV`: Default environment (dev/staging/prod)

### CI/CD
- Export config for deployment
- Flag state for canary releases
- Secret injection (with care)

### Application Integration
- **Rust**: Direct crate usage
- **Python**: `import pheno_config`
- **Go**: `import "github.com/phenotype/pheno-ffi-go"`

## Extensibility

### Custom Stores
Implement `ConfigStore`, `FlagStore`, or `SecretStore` for:
- PostgreSQL backend
- Redis caching layer
- Cloud secret managers (AWS SM, Azure Key Vault)
- etcd for distributed config

### Custom Rules
Extend `FlagRule` for:
- Geographic targeting
- Time-based rules
- Custom attributes

## FFI Architecture

### Python (PyO3)
```python
import pheno_config

config = pheno_config.ConfigStore()
config.set("app.name", "My App", scope="project")
value = config.get("app.name")
```

### Go (CGO)
```go
import pheno "github.com/phenotype/pheno-ffi-go"

store := pheno.NewConfigStore()
store.Set("app.name", "My App", pheno.ScopeProject)
value, _ := store.Get("app.name")
```
