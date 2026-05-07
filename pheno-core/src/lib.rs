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

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    // --- Stage tests ---

    #[test]
    fn test_stage_ordinal_ordering() {
        // Traces to: FR-CORE-001
        assert!(Stage::SP.ordinal() < Stage::GA.ordinal());
        assert!(Stage::GA.ordinal() < Stage::EOL.ordinal());
        assert_eq!(Stage::SP.ordinal(), 0);
        assert_eq!(Stage::EOL.ordinal(), 15);
    }

    #[test]
    fn test_stage_all_has_16_entries() {
        // Traces to: FR-CORE-001
        assert_eq!(Stage::ALL.len(), 16);
    }

    #[test]
    fn test_stage_is_pre_release() {
        // Traces to: FR-CORE-002
        assert!(Stage::SP.is_pre_release());
        assert!(Stage::POC.is_pre_release());
        assert!(Stage::B.is_pre_release());
        assert!(Stage::RC.is_pre_release());
        // GA and beyond are NOT pre-release
        assert!(!Stage::GA.is_pre_release());
        assert!(!Stage::LTS.is_pre_release());
        assert!(!Stage::EOL.is_pre_release());
    }

    #[test]
    fn test_stage_is_production() {
        // Traces to: FR-CORE-002
        assert!(Stage::GA.is_production());
        assert!(Stage::LTS.is_production());
        assert!(Stage::HF.is_production());
        assert!(!Stage::RC.is_production());
        assert!(!Stage::B.is_production());
        assert!(!Stage::DEP.is_production());
    }

    #[test]
    fn test_stage_allows_flag_gated() {
        // Traces to: FR-CORE-003
        assert!(Stage::SP.allows_flag_gated());
        assert!(Stage::RC.allows_flag_gated());
        // GA does NOT allow flag-gated (RC is the cutoff)
        assert!(!Stage::GA.allows_flag_gated());
        assert!(!Stage::LTS.allows_flag_gated());
    }

    #[test]
    fn test_stage_allows_compile_gated() {
        // Traces to: FR-CORE-003
        assert!(Stage::SP.allows_compile_gated());
        assert!(Stage::B.allows_compile_gated());
        // EP and beyond do NOT allow compile-gated
        assert!(!Stage::EP.allows_compile_gated());
        assert!(!Stage::GA.allows_compile_gated());
    }

    #[test]
    fn test_stage_display() {
        // Traces to: FR-CORE-001
        assert_eq!(Stage::GA.to_string(), "GA");
        assert_eq!(Stage::POC.to_string(), "POC");
        assert_eq!(Stage::EOL.to_string(), "EOL");
        assert_eq!(Stage::LTS.to_string(), "LTS");
    }

    #[test]
    fn test_stage_from_str_valid() {
        // Traces to: FR-CORE-001
        assert_eq!(Stage::from_str("SP").unwrap(), Stage::SP);
        assert_eq!(Stage::from_str("GA").unwrap(), Stage::GA);
        assert_eq!(Stage::from_str("EOL").unwrap(), Stage::EOL);
        assert_eq!(Stage::from_str("LTS").unwrap(), Stage::LTS);
    }

    #[test]
    fn test_stage_from_str_invalid() {
        // Traces to: FR-CORE-001
        assert!(Stage::from_str("INVALID").is_err());
        assert!(Stage::from_str("ga").is_err()); // case-sensitive
        assert!(Stage::from_str("").is_err());
    }

    #[test]
    fn test_stage_ordering_comparison() {
        // Traces to: FR-CORE-001
        assert!(Stage::SP < Stage::GA);
        assert!(Stage::GA > Stage::RC);
        assert!(Stage::GA == Stage::GA);
    }

    // --- ValueType tests ---

    #[test]
    fn test_value_type_display() {
        // Traces to: FR-CORE-004
        assert_eq!(ValueType::String.to_string(), "string");
        assert_eq!(ValueType::Int.to_string(), "int");
        assert_eq!(ValueType::Float.to_string(), "float");
        assert_eq!(ValueType::Bool.to_string(), "bool");
        assert_eq!(ValueType::Json.to_string(), "json");
    }

    #[test]
    fn test_value_type_from_str_valid() {
        // Traces to: FR-CORE-004
        assert_eq!(ValueType::from_str("string").unwrap(), ValueType::String);
        assert_eq!(ValueType::from_str("int").unwrap(), ValueType::Int);
        assert_eq!(ValueType::from_str("float").unwrap(), ValueType::Float);
        assert_eq!(ValueType::from_str("bool").unwrap(), ValueType::Bool);
        assert_eq!(ValueType::from_str("json").unwrap(), ValueType::Json);
    }

    #[test]
    fn test_value_type_from_str_invalid() {
        // Traces to: FR-CORE-004
        assert!(ValueType::from_str("unknown").is_err());
        assert!(ValueType::from_str("String").is_err()); // case-sensitive
        assert!(ValueType::from_str("").is_err());
    }

    // --- TransienceClass tests ---

    #[test]
    fn test_transience_class_display() {
        // Traces to: FR-CORE-005
        assert_eq!(TransienceClass::F.to_string(), "F");
        assert_eq!(TransienceClass::C.to_string(), "C");
        assert_eq!(TransienceClass::X.to_string(), "X");
    }

    #[test]
    fn test_transience_class_from_str_valid() {
        // Traces to: FR-CORE-005
        assert_eq!(TransienceClass::from_str("F").unwrap(), TransienceClass::F);
        assert_eq!(TransienceClass::from_str("C").unwrap(), TransienceClass::C);
        assert_eq!(TransienceClass::from_str("X").unwrap(), TransienceClass::X);
    }

    #[test]
    fn test_transience_class_from_str_invalid() {
        // Traces to: FR-CORE-005
        assert!(TransienceClass::from_str("f").is_err());
        assert!(TransienceClass::from_str("flag").is_err());
        assert!(TransienceClass::from_str("").is_err());
    }

    #[test]
    fn test_flag_gated_valid_at_pre_release_stages() {
        // Traces to: FR-CORE-005
        for &stage in &[Stage::SP, Stage::POC, Stage::IP, Stage::A, Stage::FP, Stage::B, Stage::EP, Stage::CN, Stage::RC] {
            assert!(
                TransienceClass::F.valid_at_stage(stage),
                "F should be valid at stage {:?}", stage
            );
        }
    }

    #[test]
    fn test_flag_gated_invalid_at_production_stages() {
        // Traces to: FR-CORE-005
        for &stage in &[Stage::GA, Stage::LTS, Stage::HF, Stage::SS, Stage::DEP, Stage::AR, Stage::EOL] {
            assert!(
                !TransienceClass::F.valid_at_stage(stage),
                "F should NOT be valid at stage {:?}", stage
            );
        }
    }

    #[test]
    fn test_compile_gated_valid_up_to_beta() {
        // Traces to: FR-CORE-005
        for &stage in &[Stage::SP, Stage::POC, Stage::IP, Stage::A, Stage::FP, Stage::B] {
            assert!(
                TransienceClass::C.valid_at_stage(stage),
                "C should be valid at stage {:?}", stage
            );
        }
    }

    #[test]
    fn test_compile_gated_invalid_after_beta() {
        // Traces to: FR-CORE-005
        for &stage in &[Stage::EP, Stage::CN, Stage::RC, Stage::GA, Stage::LTS] {
            assert!(
                !TransienceClass::C.valid_at_stage(stage),
                "C should NOT be valid at stage {:?}", stage
            );
        }
    }

    #[test]
    fn test_channel_exclusive_always_valid() {
        // Traces to: FR-CORE-005
        for &stage in Stage::ALL {
            assert!(
                TransienceClass::X.valid_at_stage(stage),
                "X should always be valid, failed at {:?}", stage
            );
        }
    }

    // --- Error tests ---

    #[test]
    fn test_error_display_not_found() {
        // Traces to: FR-CORE-006
        let err = Error::NotFound("config/key".to_string());
        assert_eq!(err.to_string(), "not found: config/key");
    }

    #[test]
    fn test_error_display_database() {
        // Traces to: FR-CORE-006
        let err = Error::Database("connection refused".to_string());
        assert_eq!(err.to_string(), "database error: connection refused");
    }

    #[test]
    fn test_error_display_crypto() {
        // Traces to: FR-CORE-006
        let err = Error::Crypto("key too short".to_string());
        assert_eq!(err.to_string(), "crypto error: key too short");
    }

    #[test]
    fn test_error_display_invalid_transition() {
        // Traces to: FR-CORE-006
        let err = Error::InvalidTransition("SP -> EOL not allowed".to_string());
        assert_eq!(err.to_string(), "invalid stage transition: SP -> EOL not allowed");
    }

    #[test]
    fn test_error_display_other() {
        // Traces to: FR-CORE-006
        let err = Error::Other("generic error".to_string());
        assert_eq!(err.to_string(), "generic error");
    }

    // --- build_info tests ---

    #[test]
    fn test_build_info_defaults() {
        // Traces to: FR-CORE-007
        // Without env vars set, defaults should be used
        assert!(!build_info::HELIOS_STAGE.is_empty() || build_info::HELIOS_STAGE == "unknown");
        assert!(!build_info::HELIOS_CHANNEL.is_empty() || build_info::HELIOS_CHANNEL == "dev");
    }
}
