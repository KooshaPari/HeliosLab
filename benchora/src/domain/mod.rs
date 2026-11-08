//! Domain layer - Pure business logic with no external dependencies.
//!
//! ## Error Handling (PoLA - Principle of Least Astonishment)
//!
//! All domain errors follow these principles:
//! 1. Messages are descriptive and actionable
//! 2. Context is attached for debugging
//! 3. Errors are categorized by domain concept

use serde::{Deserialize, Serialize};
use std::fmt;

/// Domain-level result type for consistent error handling.
pub type XddResult<T> = Result<T, XddError>;

/// Base error type for xDD operations.
///
/// Follows PoLA: error messages are descriptive, actionable,
/// and include context for debugging.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XddError {
    /// Human-readable error message
    pub message: String,
    /// Error category for programmatic handling
    pub category: ErrorCategory,
    /// Additional context for debugging
    #[serde(default)]
    pub context: serde_json::Value,
}

impl XddError {
    /// Create a new XddError with message and category.
    pub fn new(message: impl Into<String>, category: ErrorCategory) -> Self {
        Self {
            message: message.into(),
            category,
            context: serde_json::Value::Null,
        }
    }

    /// Add context to an error.
    pub fn with_context(mut self, key: impl Into<String>, value: impl Serialize) -> Self {
        // Ensure context is an object
        if self.context.is_null() || !self.context.is_object() {
            self.context = serde_json::json!({});
        }
        // Now safely get the mutable reference
        if let Some(map) = self.context.as_object_mut() {
            map.insert(key.into(), serde_json::json!(value));
        }
        self
    }

    /// Create a property testing error.
    pub fn property(message: impl Into<String>) -> Self {
        Self::new(message, ErrorCategory::Property)
    }

    /// Create a contract verification error.
    pub fn contract(message: impl Into<String>) -> Self {
        Self::new(message, ErrorCategory::Contract)
    }

    /// Create a mutation coverage error.
    pub fn mutation(message: impl Into<String>) -> Self {
        Self::new(message, ErrorCategory::Mutation)
    }

    /// Create a specification parsing error.
    pub fn spec(message: impl Into<String>) -> Self {
        Self::new(message, ErrorCategory::Spec)
    }

    /// Create an internal/unexpected error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(message, ErrorCategory::Internal)
    }
}

impl fmt::Display for XddError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.category, self.message)
    }
}

impl std::error::Error for XddError {}

/// Error categories for programmatic handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    /// Property-based testing errors
    Property,
    /// Contract testing errors
    Contract,
    /// Mutation testing errors
    Mutation,
    /// Specification parsing/validation errors
    Spec,
    /// Internal/unexpected errors
    Internal,
}

impl fmt::Display for ErrorCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorCategory::Property => write!(f, "property"),
            ErrorCategory::Contract => write!(f, "contract"),
            ErrorCategory::Mutation => write!(f, "mutation"),
            ErrorCategory::Spec => write!(f, "spec"),
            ErrorCategory::Internal => write!(f, "internal"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Factory constructors ──────────────────────────────────────────────

    #[test]
    fn new_sets_message_and_category() {
        let e = XddError::new("something failed", ErrorCategory::Internal);
        assert_eq!(e.message, "something failed");
        assert_eq!(e.category, ErrorCategory::Internal);
        assert!(e.context.is_null());
    }

    #[test]
    fn property_factory_sets_category() {
        let e = XddError::property("bad value");
        assert_eq!(e.category, ErrorCategory::Property);
    }

    #[test]
    fn contract_factory_sets_category() {
        let e = XddError::contract("adapter mismatch");
        assert_eq!(e.category, ErrorCategory::Contract);
    }

    #[test]
    fn mutation_factory_sets_category() {
        let e = XddError::mutation("low kill rate");
        assert_eq!(e.category, ErrorCategory::Mutation);
    }

    #[test]
    fn spec_factory_sets_category() {
        let e = XddError::spec("missing field");
        assert_eq!(e.category, ErrorCategory::Spec);
    }

    // ── with_context ─────────────────────────────────────────────────────

    #[test]
    fn with_context_adds_key_value_pair() {
        let e = XddError::property("oops").with_context("file", "src/lib.rs");
        let ctx = e
            .context
            .as_object()
            .expect("context must be a JSON object");
        assert_eq!(ctx["file"], serde_json::json!("src/lib.rs"));
    }

    #[test]
    fn with_context_multiple_keys_accumulate() {
        let e = XddError::internal("fail")
            .with_context("line", 42_u64)
            .with_context("col", 7_u64);
        let ctx = e
            .context
            .as_object()
            .expect("context must be a JSON object");
        assert_eq!(ctx["line"], serde_json::json!(42));
        assert_eq!(ctx["col"], serde_json::json!(7));
    }

    // ── Display ──────────────────────────────────────────────────────────

    #[test]
    fn display_includes_category_and_message() {
        let e = XddError::spec("missing name");
        let s = e.to_string();
        assert!(s.contains("spec"), "display must include category: {s}");
        assert!(
            s.contains("missing name"),
            "display must include message: {s}"
        );
    }

    #[test]
    fn error_category_display_all_variants() {
        assert_eq!(ErrorCategory::Property.to_string(), "property");
        assert_eq!(ErrorCategory::Contract.to_string(), "contract");
        assert_eq!(ErrorCategory::Mutation.to_string(), "mutation");
        assert_eq!(ErrorCategory::Spec.to_string(), "spec");
        assert_eq!(ErrorCategory::Internal.to_string(), "internal");
    }

    // ── std::error::Error impl ───────────────────────────────────────────

    #[test]
    fn xdd_error_implements_std_error() {
        let e = XddError::internal("boom");
        // Coerce to trait object — compile-time proof of impl.
        let _: &dyn std::error::Error = &e;
    }
}
