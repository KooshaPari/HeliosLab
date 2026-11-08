//! Reusable property testing strategies.
//!
//! ## Design Principles
//!
//! - **DRY**: Shared across all tests
//! - **KISS**: Simple, composable strategies
//! - **YAGNI**: Only essential strategies included
//!
//! ## Categories
//!
//! - String strategies (emails, UUIDs, URLs)
//! - Number strategies (positive, negative, bounded)
//! - Collection strategies (non-empty, bounded size)
//! - Composite strategies (valid entities)

use crate::domain::{XddError, XddResult};
use proptest::prelude::*;
use proptest::strategy::Strategy;

/// Result type for strategy validation.
pub type StrategyResult<T> = Result<T, XddError>;

/// Validate a UUID v4 format.
pub fn valid_uuid(s: &str) -> XddResult<&str> {
    if s.len() != 36 {
        return Err(XddError::property("UUID must be 36 characters"));
    }
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 5 {
        return Err(XddError::property(
            "UUID must have 5 hyphen-separated parts",
        ));
    }
    if parts[0].len() != 8
        || parts[1].len() != 4
        || parts[2].len() != 4
        || parts[3].len() != 4
        || parts[4].len() != 12
    {
        return Err(XddError::property(
            "UUID parts must be 8-4-4-4-12 characters",
        ));
    }
    Ok(s)
}

/// Validate an email format.
pub fn valid_email(s: &str) -> XddResult<&str> {
    if !s.contains('@') {
        return Err(XddError::property("Email must contain @"));
    }
    let parts: Vec<&str> = s.split('@').collect();
    if parts.len() != 2 {
        return Err(XddError::property("Email must have exactly one @"));
    }
    if parts[0].is_empty() || parts[1].is_empty() {
        return Err(XddError::property(
            "Email local and domain parts must be non-empty",
        ));
    }
    if !parts[1].contains('.') {
        return Err(XddError::property(
            "Email domain must contain at least one dot",
        ));
    }
    Ok(s)
}

/// Validate a URL format.
pub fn valid_url(s: &str) -> XddResult<&str> {
    if !s.starts_with("http://") && !s.starts_with("https://") {
        return Err(XddError::property(
            "URL must start with http:// or https://",
        ));
    }
    if s.len() < 10 {
        return Err(XddError::property("URL must be at least 10 characters"));
    }
    Ok(s)
}

/// Validate a positive integer.
pub fn positive_int(n: i64) -> XddResult<i64> {
    if n <= 0 {
        return Err(XddError::property("Value must be positive"));
    }
    Ok(n)
}

/// Validate a bounded integer.
pub fn bounded_int(n: i64, min: i64, max: i64) -> XddResult<i64> {
    if n < min || n > max {
        return Err(XddError::property(format!(
            "Value {} must be between {} and {}",
            n, min, max
        )));
    }
    Ok(n)
}

/// Validate a non-empty string.
///
/// Note: this checks structural emptiness only (zero bytes); whitespace-only
/// strings are considered non-empty because they are a valid textual input.
/// Use a separate validator if semantic "blank" rejection is required.
pub fn non_empty_string(s: &str) -> XddResult<&str> {
    if s.is_empty() {
        return Err(XddError::property("String must be non-empty"));
    }
    Ok(s)
}

/// Validate a non-empty collection.
pub fn non_empty<T>(coll: &[T]) -> XddResult<&[T]> {
    if coll.is_empty() {
        return Err(XddError::property("Collection must be non-empty"));
    }
    Ok(coll)
}

/// Validate string length bounds.
pub fn bounded_length(s: &str, min: usize, max: usize) -> XddResult<&str> {
    let len = s.len();
    if len < min || len > max {
        return Err(XddError::property(format!(
            "String length {} must be between {} and {}",
            len, min, max
        )));
    }
    Ok(s)
}

// ============================================================================
// Proptest Strategy Wrappers
// ============================================================================

/// Generate a random valid UUID v4.
pub fn uuid_strategy() -> impl Strategy<Value = String> {
    "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}".prop_map(|s| s)
}

/// Generate a random valid email.
pub fn email_strategy() -> impl Strategy<Value = String> {
    (".+@+.+", 3..100).prop_map(|(local, domain)| format!("{}@{}", local, domain))
}

/// Generate a random bounded integer.
pub fn int_strategy(min: i64, max: i64) -> impl Strategy<Value = i64> {
    // Use inclusive range for proptest
    min..=max
}

/// Generate a random non-empty string.
pub fn non_empty_string_strategy(max_len: usize) -> impl Strategy<Value = String> {
    // Pattern `.{1,N}` is a valid `regex_syntax::Regex` for every `usize` N
    // (only the literal dot and a quantified repetition `{m,n}`), so the
    // returned `Strategy` cannot fail to compile.
    proptest::string::string_regex(&format!(".{{1,{}}}", max_len))
        .expect("invariant: `.{1,N}` is a valid regex for every usize N")
}

/// Generate a random valid URL.
pub fn url_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        "https://example.com",
        "http://localhost:8080",
        "https://api.service.io/v1",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_uuid_success() {
        let result = valid_uuid("550e8400-e29b-41d4-a716-446655440000");
        assert!(result.is_ok());
        // The literal is a known-good fixture; unwrap is unnecessary because
        // we already asserted success on the line above.
        assert_eq!(
            result.expect("test fixture is a hard-coded valid UUID v4"),
            "550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[test]
    fn test_valid_uuid_wrong_length() {
        let result = valid_uuid("550e8400-e29b-41d4-a716");
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_email_success() {
        let result = valid_email("user@example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn test_valid_email_no_at() {
        let result = valid_email("userexample.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_positive_int_success() {
        assert_eq!(positive_int(42).expect("test fixture 42 is positive"), 42);
    }

    #[test]
    fn test_positive_int_zero() {
        assert!(positive_int(0).is_err());
    }

    #[test]
    fn test_bounded_int_success() {
        assert_eq!(
            bounded_int(50, 0, 100).expect("test fixture 50 is within [0,100]"),
            50
        );
    }

    #[test]
    fn test_bounded_int_too_high() {
        assert!(bounded_int(150, 0, 100).is_err());
    }

    #[test]
    fn test_non_empty_string() {
        assert!(non_empty_string("hello").is_ok());
        assert!(non_empty_string("   ").is_ok()); // Whitespace is valid
        assert!(non_empty_string("").is_err());
    }

    #[test]
    fn test_non_empty_slice() {
        assert!(non_empty(&[1, 2, 3]).is_ok());
        assert!(non_empty(&[] as &[i32]).is_err());
    }

    #[test]
    fn test_bounded_length() {
        assert!(bounded_length("hello", 3, 10).is_ok());
        assert!(bounded_length("hi", 3, 10).is_err());
        assert!(bounded_length("hello world this is too long", 3, 10).is_err());
    }
}
