//! Soft contract for CLI config surface (`BENCH-003` / L20 Config).
//!
//! Locks clap defaults and `BENCHORA_DB` env wiring so SPEC/SSOT env tables
//! stay honest. Soft evidence only — no org secrets.

use std::path::PathBuf;
use std::sync::Mutex;

use clap::{CommandFactory, Parser};
use phenotype_xdd_lib::cli::Cli;

/// Serialize tests that mutate `BENCHORA_DB` (process-global env).
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// @trace BENCH-003
#[test]
fn clap_db_default_is_benchora_db() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::remove_var("BENCHORA_DB");

    let cli = Cli::try_parse_from(["benchora", "list"]).expect("parse list with defaults");
    assert_eq!(
        cli.db,
        PathBuf::from("benchora.db"),
        "SPEC/SSOT default for BENCHORA_DB / --db must stay benchora.db"
    );
}

/// @trace BENCH-003
#[test]
fn clap_db_env_benchoradb_overrides_default() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("BENCHORA_DB", "target/benchora-tests/contract-env.db");

    let cli = Cli::try_parse_from(["benchora", "list"]).expect("parse list with BENCHORA_DB");
    assert_eq!(
        cli.db,
        PathBuf::from("target/benchora-tests/contract-env.db")
    );

    std::env::remove_var("BENCHORA_DB");
}

/// @trace BENCH-003
#[test]
fn clap_db_flag_overrides_env() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("BENCHORA_DB", "from-env.db");

    let cli = Cli::try_parse_from(["benchora", "--db", "from-flag.db", "list"])
        .expect("parse list with --db");
    assert_eq!(cli.db, PathBuf::from("from-flag.db"));

    std::env::remove_var("BENCHORA_DB");
}

/// @trace BENCH-003
#[test]
fn clap_long_help_documents_benchoradb_env() {
    let help = Cli::command().render_long_help().to_string();
    assert!(
        help.contains("BENCHORA_DB"),
        "long help must advertise BENCHORA_DB (clap env=); got:\n{help}"
    );
    assert!(
        help.contains("--db") || help.contains("db"),
        "long help must mention --db; got:\n{help}"
    );
}

/// @trace BENCH-003
#[test]
fn clap_compare_help_documents_regression_threshold_env() {
    // Threshold env is on the `compare` subcommand, not top-level globals.
    let help = Cli::command()
        .find_subcommand_mut("compare")
        .expect("compare subcommand")
        .render_long_help()
        .to_string();
    assert!(
        help.contains("BENCHORA_REGRESSION_THRESHOLD_PCT"),
        "compare long help must advertise BENCHORA_REGRESSION_THRESHOLD_PCT; got:\n{help}"
    );
}
