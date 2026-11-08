//! Contract testing module.
//!
//! ## xDD Methodology: Contract-Driven Development (CDD)
//!
//! Contract testing verifies that an adapter implements a port
//! correctly. The contract defines the expected behavior.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────┐         ┌─────────────┐
//! │   Port      │         │   Port      │
//! │ (Interface) │         │ (Interface) │
//! └──────┬──────┘         └──────┬──────┘
//!        │                        │
//!        │    ┌────────────────┐  │
//!        └───►│   Contract     │◄─┘
//!             │  (Test Suite)  │
//!             └────────────────┘
//!                    │
//!        ┌───────────┴───────────┐
//!        │                       │
//! ┌──────▼──────┐        ┌──────▼──────┐
//! │   Adapter   │        │   Adapter   │
//! │ (Implement) │        │ (Implement) │
//! └─────────────┘        └─────────────┘
//! ```
//!
//! ## Usage
//!
//! ```rust
//! use phenotype_xdd_lib::contract::{Contract, ContractVerifier};
//!
//! // Define a port (interface)
//! trait StoragePort {
//!     fn get(&self, key: &str) -> Option<String>;
//!     fn set(&mut self, key: &str, value: String);
//! }
//!
//! // Define a contract that verifies the adapter
//! struct MemoryStorageContract;
//!
//! impl Contract for MemoryStorageContract {
//!     fn name() -> &'static str { "MemoryStorage" }
//!     fn verify() -> phenotype_xdd_lib::domain::XddResult<()> { Ok(()) }
//! }
//!
//! let mut verifier = ContractVerifier::new();
//! verifier.verify::<MemoryStorageContract>();
//! ```

use crate::domain::XddResult;

/// Contract trait - defines the interface that adapters must implement.
///
/// Following the Hexagonal Architecture pattern:
/// - Ports define the interface
/// - Adapters implement the interface
/// - Contracts verify the implementation
pub trait Contract {
    /// Name of the contract for reporting.
    fn name() -> &'static str
    where
        Self: Sized;

    /// Verify the contract is satisfied.
    fn verify() -> XddResult<()>
    where
        Self: Sized;
}

/// Contract verification result with details.
#[derive(Debug, Clone)]
pub struct ContractResult {
    /// Whether verification passed.
    pub passed: bool,
    /// Name of the contract.
    pub contract_name: String,
    /// Number of assertions run.
    pub assertions: usize,
    /// Failures if any.
    pub failures: Vec<ContractFailure>,
}

/// A single contract assertion failure.
#[derive(Debug, Clone)]
pub struct ContractFailure {
    /// Description of what was expected.
    pub expectation: String,
    /// Actual value or error.
    pub actual: String,
    /// Location in source.
    pub location: Option<String>,
}

impl ContractResult {
    /// Create a successful verification result.
    pub fn success(contract_name: impl Into<String>, assertions: usize) -> Self {
        Self {
            passed: true,
            contract_name: contract_name.into(),
            assertions,
            failures: vec![],
        }
    }

    /// Create a failed verification result.
    pub fn failure(
        contract_name: impl Into<String>,
        assertions: usize,
        failures: Vec<ContractFailure>,
    ) -> Self {
        Self {
            passed: false,
            contract_name: contract_name.into(),
            assertions,
            failures,
        }
    }
}

/// Contract verifier utility.
///
/// Provides helpers for running contract tests.
#[derive(Debug, Default)]
pub struct ContractVerifier {
    assertions: usize,
    failures: Vec<ContractFailure>,
}

impl ContractVerifier {
    /// Create a new verifier.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an assertion.
    pub fn assert(&mut self, condition: bool, expectation: &str, actual: &str) {
        self.assertions += 1;
        if !condition {
            self.failures.push(ContractFailure {
                expectation: expectation.to_string(),
                actual: actual.to_string(),
                location: None,
            });
        }
    }

    /// Assert two values are equal.
    pub fn assert_eq<T: PartialEq + std::fmt::Debug>(
        &mut self,
        expected: T,
        actual: T,
        _msg: &str,
    ) {
        self.assertions += 1;
        if expected != actual {
            self.failures.push(ContractFailure {
                expectation: format!("{:?}", expected),
                actual: format!("{:?}", actual),
                location: None,
            });
        }
    }

    /// Verify an adapter satisfies a contract.
    pub fn verify<C: Contract>(&mut self) -> XddResult<()> {
        C::verify()?;
        Ok(())
    }

    /// Build the result.
    pub fn result(self, contract_name: &str) -> ContractResult {
        if self.failures.is_empty() {
            ContractResult::success(contract_name, self.assertions)
        } else {
            ContractResult::failure(contract_name, self.assertions, self.failures)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contract_verifier_assertions() {
        let mut verifier = ContractVerifier::new();
        verifier.assert(true, "should pass", "passed");
        let result = verifier.result("test");
        assert!(result.passed);
        assert_eq!(result.assertions, 1);
    }

    #[test]
    fn test_contract_verifier_failures() {
        let mut verifier = ContractVerifier::new();
        verifier.assert(false, "should pass", "failed");
        let result = verifier.result("test");
        assert!(!result.passed);
        assert_eq!(result.failures.len(), 1);
    }

    #[test]
    fn test_contract_result_success() {
        let result = ContractResult::success("test_contract", 5);
        assert!(result.passed);
        assert_eq!(result.assertions, 5);
        assert!(result.failures.is_empty());
    }

    #[test]
    fn test_contract_result_failure() {
        let failure = ContractFailure {
            expectation: "value > 0".to_string(),
            actual: "value = 0".to_string(),
            location: None,
        };
        let result = ContractResult::failure("test_contract", 1, vec![failure]);
        assert!(!result.passed);
        assert_eq!(result.failures.len(), 1);
    }
}
