//! Property-based testing module.
//!
//! Provides strategies and generators for property-based testing
//! using proptest and quickcheck.
//!
//! ## xDD Methodology: Property-Based Testing
//!
//! Property-based testing (PBT) verifies that a function's behavior
//! satisfies certain properties for all possible inputs.
//!
//! ## Example
//!
//! ```rust
//! use phenotype_xdd_lib::property::strategies::valid_email;
//!
//! assert!(valid_email("user@example.com").is_ok());
//! ```

pub mod strategies;

pub use strategies::*;
