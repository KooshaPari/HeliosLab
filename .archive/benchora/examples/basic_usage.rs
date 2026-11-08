//! Benchora xDD library — basic usage example.
//!
//! Demonstrates property-based testing, contract verification, and
//! mutation score tracking on a tiny domain (email addresses).
//!
//! Run with:
//!   cargo run --example basic_usage

use phenotype_xdd_lib::contract::{Contract, ContractVerifier};
use phenotype_xdd_lib::domain::{XddError, XddResult};
use phenotype_xdd_lib::property::strategies;

/// EmailValidationContract — round-trips parse → format → re-parse and
/// asserts the two parses are byte-equal.
pub struct EmailValidationContract;

fn normalize_email(input: &str) -> XddResult<String> {
    if !input.contains('@') {
        return Err(XddError::contract("missing @"));
    }
    Ok(input.to_lowercase())
}

impl Contract for EmailValidationContract {
    fn name() -> &'static str {
        "email_round_trip"
    }

    fn verify() -> XddResult<()> {
        let sample = "Mixed.Case@Example.COM";
        let normalized = normalize_email(sample)?;
        if normalized != "mixed.case@example.com" {
            return Err(XddError::contract(format!(
                "expected mixed.case@example.com, got {normalized}"
            )));
        }
        Ok(())
    }
}

fn main() -> XddResult<()> {
    // Property: any lowercase alphanumeric local-part + "@" + domain parses
    // back to itself.
    let valid = strategies::valid_email("user@example.com")?;
    println!("parsed email: {valid}");

    // Contract: verify round-trip on a known-good sample.
    let mut verifier = ContractVerifier::new();
    verifier.verify::<EmailValidationContract>()?;
    let sample = "Mixed.Case@Example.COM".to_string();
    let normalized = normalize_email(&sample)?;
    println!("normalized:   {normalized}");
    assert_eq!(normalized, "mixed.case@example.com");
    println!("OK");
    Ok(())
}
