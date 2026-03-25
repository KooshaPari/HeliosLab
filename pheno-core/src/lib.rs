use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

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
    #[error("{0}")]
    Other(String),
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
pub enum ValueType {
    String,
    Int,
    Float,
    Bool,
    Json,
}

impl fmt::Display for ValueType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::String => write!(f, "string"),
            Self::Int => write!(f, "int"),
            Self::Float => write!(f, "float"),
            Self::Bool => write!(f, "bool"),
            Self::Json => write!(f, "json"),
        }
    }
}

impl std::str::FromStr for ValueType {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "string" => Ok(Self::String),
            "int" => Ok(Self::Int),
            "float" => Ok(Self::Float),
            "bool" => Ok(Self::Bool),
            "json" => Ok(Self::Json),
            _ => Err(Error::Other(format!("unknown value type: {s}"))),
        }
    }
}

/// The 16 lifecycle stages, ordered from earliest to latest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Stage {
    SP,  // Specification / Planning
    POC, // Proof of Concept
    IP,  // Initial Prototype
    A,   // Alpha
    FP,  // Feature Preview
    B,   // Beta
    EP,  // Early Production
    CN,  // Canary
    RC,  // Release Candidate
    GA,  // General Availability
    LTS, // Long-Term Support
    HF,  // Hotfix
    SS,  // Sunset / Stability-only
    DEP, // Deprecated
    AR,  // Archived
    EOL, // End of Life
}

impl Stage {
    pub const ALL: &'static [Stage] = &[
        Stage::SP, Stage::POC, Stage::IP, Stage::A, Stage::FP, Stage::B,
        Stage::EP, Stage::CN, Stage::RC, Stage::GA, Stage::LTS, Stage::HF,
        Stage::SS, Stage::DEP, Stage::AR, Stage::EOL,
    ];

    pub fn ordinal(self) -> usize {
        Self::ALL.iter().position(|&s| s == self).unwrap()
    }

    pub fn is_pre_release(self) -> bool {
        self.ordinal() < Stage::GA.ordinal()
    }

    pub fn is_production(self) -> bool {
        matches!(self, Stage::GA | Stage::LTS | Stage::HF)
    }

    pub fn allows_flag_gated(self) -> bool {
        // Flag-gatable features are allowed in pre-release and canary/RC
        self.ordinal() <= Stage::RC.ordinal()
    }

    pub fn allows_compile_gated(self) -> bool {
        // Compile-gated features are allowed up through beta
        self.ordinal() <= Stage::B.ordinal()
    }
}

impl fmt::Display for Stage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", match self {
            Stage::SP => "SP", Stage::POC => "POC", Stage::IP => "IP",
            Stage::A => "A", Stage::FP => "FP", Stage::B => "B",
            Stage::EP => "EP", Stage::CN => "CN", Stage::RC => "RC",
            Stage::GA => "GA", Stage::LTS => "LTS", Stage::HF => "HF",
            Stage::SS => "SS", Stage::DEP => "DEP", Stage::AR => "AR",
            Stage::EOL => "EOL",
        })
    }
}

impl std::str::FromStr for Stage {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "SP" => Ok(Stage::SP), "POC" => Ok(Stage::POC), "IP" => Ok(Stage::IP),
            "A" => Ok(Stage::A), "FP" => Ok(Stage::FP), "B" => Ok(Stage::B),
            "EP" => Ok(Stage::EP), "CN" => Ok(Stage::CN), "RC" => Ok(Stage::RC),
            "GA" => Ok(Stage::GA), "LTS" => Ok(Stage::LTS), "HF" => Ok(Stage::HF),
            "SS" => Ok(Stage::SS), "DEP" => Ok(Stage::DEP), "AR" => Ok(Stage::AR),
            "EOL" => Ok(Stage::EOL),
            _ => Err(Error::Other(format!("unknown stage: {s}"))),
        }
    }
}

/// Transience classification for feature flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TransienceClass {
    F, // Flag-gatable: runtime toggle, removed at GA
    C, // Compile-gatable: compile-time toggle, removed at beta exit
    X, // Channel-exclusive: only in specific build channels
}

impl TransienceClass {
    /// Validate that this transience class is allowed at the given stage.
    pub fn valid_at_stage(self, stage: Stage) -> bool {
        match self {
            TransienceClass::F => stage.allows_flag_gated(),
            TransienceClass::C => stage.allows_compile_gated(),
            TransienceClass::X => true, // channel-exclusive is always valid (controlled by channel list)
        }
    }
}

impl fmt::Display for TransienceClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::F => write!(f, "F"),
            Self::C => write!(f, "C"),
            Self::X => write!(f, "X"),
        }
    }
}

impl std::str::FromStr for TransienceClass {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "F" => Ok(Self::F),
            "C" => Ok(Self::C),
            "X" => Ok(Self::X),
            _ => Err(Error::Other(format!("unknown transience class: {s}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlag {
    pub name: String,
    pub enabled: bool,
    pub namespace: String,
    pub description: String,
    pub updated_at: DateTime<Utc>,
    pub stage: String,
    pub transience_class: String,
    pub channel: Vec<String>,
    pub retire_at_stage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageTransition {
    pub id: i64,
    pub flag_name: String,
    pub from_stage: String,
    pub to_stage: String,
    pub transitioned_at: DateTime<Utc>,
    pub transitioned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    pub key: String,
    pub encrypted_value: Vec<u8>,
    pub nonce: Vec<u8>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub repo: String,
    pub our_version: String,
    pub upstream_version: String,
    pub synced_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: i64,
    pub key: String,
    pub namespace: String,
    pub old_value: Option<String>,
    pub new_value: String,
    pub changed_by: String,
    pub changed_at: DateTime<Utc>,
}

pub trait ConfigStore {
    fn get_config(&self, namespace: &str, key: &str) -> Result<ConfigEntry>;
    fn set_config(&self, entry: &ConfigEntry) -> Result<()>;
    fn list_config(&self, namespace: &str) -> Result<Vec<ConfigEntry>>;
    fn delete_config(&self, namespace: &str, key: &str) -> Result<()>;
    fn audit_log(&self, namespace: &str, key: &str) -> Result<Vec<AuditRecord>>;
    fn restore_config(&self, namespace: &str, key: &str, audit_id: i64) -> Result<ConfigEntry>;
}

pub trait FlagStore {
    fn get_flag(&self, namespace: &str, name: &str) -> Result<FeatureFlag>;
    fn list_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
    fn set_flag(&self, flag: &FeatureFlag) -> Result<()>;
    fn delete_flag(&self, namespace: &str, name: &str) -> Result<()>;
    fn promote_flag(&self, namespace: &str, name: &str, new_stage: &str, by: &str) -> Result<()>;
    fn audit_flags(&self, namespace: &str) -> Result<Vec<FeatureFlag>>;
}

pub trait SecretStore {
    fn get_secret(&self, key: &str) -> Result<SecretEntry>;
    fn set_secret(&self, entry: &SecretEntry) -> Result<()>;
    fn list_secrets(&self) -> Result<Vec<String>>;
    fn delete_secret(&self, key: &str) -> Result<()>;
}

pub trait VersionStore {
    fn get_version(&self, repo: &str) -> Result<VersionInfo>;
    fn set_version(&self, info: &VersionInfo) -> Result<()>;
    fn list_versions(&self) -> Result<Vec<VersionInfo>>;
}

pub mod build_info {
    macro_rules! env_or {
        ($name:expr, $default:expr) => {
            match option_env!($name) {
                Some(v) => v,
                None => $default,
            }
        };
    }
    pub const HELIOS_STAGE: &str = env_or!("HELIOS_STAGE", "unknown");
    pub const HELIOS_CHANNEL: &str = env_or!("HELIOS_CHANNEL", "dev");
    pub const HELIOS_BUILD_FLAGS: &str = env_or!("HELIOS_BUILD_FLAGS", "");
}
