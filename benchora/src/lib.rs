//! # phenotype-xdd-lib
//!
//! Cross-cutting xDD utilities library for Rust projects. The `benchora`
//! binary is a thin CLI over this crate (`cli` module; see
//! `docs/API_REFERENCE.md` and `BENCH-006` help-contract tests).
//!
//! ## Features
//!
//! - **CLI (`cli`)**: `run` / `report` / `baseline` / `compare` / `mutate` / `list`
//! - **Property Testing**: Strategy definitions and custom generators
//! - **Contract Testing**: Port/Adapter verification
//! - **Mutation Testing**: Coverage tracking utilities
//! - **SpecDD**: Specification parsing and validation
//!
//! ## Architecture
//!
//! Follows hexagonal/clean architecture principles:
//!
//! ```text
//! ┌─────────────────────────────────────────────────┐
//! │                  Domain Layer                    │
//! │  (Pure business logic, no dependencies)         │
//! ├─────────────────────────────────────────────────┤
//! │                Application Layer                 │
//! │  (Use cases, ports interfaces)                   │
//! ├─────────────────────────────────────────────────┤
//! │              Infrastructure Layer                │
//! │  (Adapters: proptest, quickcheck, etc.)         │
//! └─────────────────────────────────────────────────┘
//! ```
//!
//! ## xDD Methodologies Applied
//!
//! | Category | Methodology | Implementation |
//! |----------|-------------|----------------|
//! | Development | TDD | Red-green-refactor cycle |
//! | Development | BDD | Descriptive test names |
//! | Development | Property-Based | proptest strategies |
//! | Development | Contract | Port verification |
//! | Design | SOLID | Single responsibility |
//! | Design | DRY | Shared strategies |
//!
//! ## Example
//!
//! ```rust
//! use phenotype_xdd_lib::property::strategies::valid_uuid;
//!
//! assert!(valid_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
//! ```

pub mod cli;
pub mod contract;
pub mod domain;
pub mod mutation;
pub mod property;
pub mod spec;

// Re-export commonly used items
pub use contract::{Contract, ContractVerifier};
pub use domain::{XddError, XddResult};
pub use property::strategies;
