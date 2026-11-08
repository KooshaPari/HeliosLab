//! Benchora CLI (`BENCH-006` / L15 API Surface)
//!
//! Thin command-line surface over the `phenotype_xdd_lib` core. Lets you run a
//! benchmark suite, capture a JSON report, store baselines, compare current
//! runs against a stored baseline, and drive mutation testing.
//!
//! Human docs: `docs/API_REFERENCE.md`. Soft contract:
//! `tests/cli_help_contract_test.rs` (asserts `benchora --help` subcommands
//! stay in lockstep with this module).
//!
//! # Subcommands
//!
//! * [`Cmd::Run`] — run a benchmark suite and write a report
//! * [`Cmd::Report`] — read a saved report, summarize to stdout
//! * [`Cmd::Baseline`] — promote a report to a named baseline
//! * [`Cmd::Compare`] — diff the current report against a stored baseline
//! * [`Cmd::Mutate`] — run mutation testing via `cargo mutants`
//! * [`Cmd::List`] — list stored baselines / reports / mutations
//!
//! All subcommands accept `--db <path>` (or the env var `BENCHORA_DB`) to
//! point at a SQLite file that stores baselines and report metadata. The
//! default is `benchora.db` in the current working directory.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

pub mod baseline;
pub mod compare;
pub(crate) mod compare_criterion;
pub(crate) mod compare_heliosbench;
pub mod error;
pub mod mutate;
pub(crate) mod mutate_parse;
pub mod report;
pub mod time_utils;
pub mod tracker_db;

pub use error::CliError;

/// Top-level CLI (`benchora`).
///
/// Parse with [`clap::Parser`]; dispatch with [`run`]. Public surface is the
/// clap help tree — see module docs and `docs/API_REFERENCE.md`.
#[derive(Parser, Debug)]
#[command(
    name = "benchora",
    version,
    about = "Benchora CLI — benchmark run/report/baseline/compare/mutate for phenotype xDD."
)]
pub struct Cli {
    /// Path to the Benchora SQLite DB.
    #[arg(
        long,
        env = "BENCHORA_DB",
        default_value = "benchora.db",
        global = true
    )]
    pub db: PathBuf,

    #[command(subcommand)]
    pub cmd: Cmd,
}

/// CLI subcommand tree (must match `EXPECTED_SUBCOMMANDS` in
/// `tests/cli_help_contract_test.rs` and `docs/API_REFERENCE.md`).
#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Run a benchmark suite and capture a report.
    Run {
        /// Suite name (e.g. `core`, `mutation`, `property`).
        #[arg(long, default_value = "core")]
        suite: String,
        /// Optional output JSON path; defaults to `<suite>-<timestamp>.json`.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Summarize a saved report.
    Report {
        /// Path to the report JSON.
        path: PathBuf,
    },
    /// Promote a report to a named baseline.
    Baseline {
        /// Baseline name (e.g. `nightly`, `release-1.0`).
        name: String,
        /// Path to the report JSON to promote.
        #[arg(long)]
        from: PathBuf,
    },
    /// Compare a report against a stored baseline.
    Compare {
        /// Baseline name.
        baseline: String,
        /// Path to the current report.
        #[arg(long)]
        current: PathBuf,
        /// Override the regression threshold (percent) for this run.
        /// Falls back to `BENCHORA_REGRESSION_THRESHOLD_PCT` env var,
        /// then the DB, then 5.0.
        #[arg(long, value_name = "PCT", env = "BENCHORA_REGRESSION_THRESHOLD_PCT")]
        regression_threshold_pct: Option<f64>,
    },
    /// Run mutation testing.
    Mutate {
        /// Package to mutate (passed to `cargo mutants -p <pkg>`).
        #[arg(long)]
        package: Option<String>,
        /// Restrict mutations to a single source file path.
        #[arg(long)]
        file: Option<PathBuf>,
        /// Minimum mutation score required for success (0-100).
        /// Fails the run if the measured kill rate is below the threshold.
        #[arg(long, value_name = "PCT")]
        min_score: Option<f64>,
        /// Directory for `cargo mutants` output. Default: `mutants-out`.
        #[arg(long, default_value = "mutants-out")]
        output: Option<PathBuf>,
    },
    /// List stored baselines / reports.
    List {
        /// What to list.
        #[arg(value_enum, default_value_t = ListKind::Baselines)]
        kind: ListKind,
    },
}

#[derive(clap::ValueEnum, Clone, Debug)]
pub enum ListKind {
    Baselines,
    Reports,
    Mutations,
}

/// Entry-point invoked by `src/bin/benchora.rs`.
pub fn run(cli: Cli) -> Result<(), CliError> {
    match cli.cmd {
        Cmd::Run { suite, out } => report::run_suite(&cli.db, &suite, out.as_deref()),
        Cmd::Report { path } => report::summarize(&path),
        Cmd::Baseline { name, from } => baseline::promote(&cli.db, &name, &from),
        Cmd::Compare {
            baseline,
            current,
            regression_threshold_pct,
        } => {
            // Per-invocation override takes precedence over env/DB/default.
            if let Some(v) = regression_threshold_pct {
                if v.is_finite() {
                    std::env::set_var("BENCHORA_REGRESSION_THRESHOLD_PCT", v.to_string());
                }
            }
            compare::diff(&cli.db, &baseline, &current)
        }
        Cmd::Mutate {
            package,
            file,
            min_score,
            output,
        } => mutate::run(
            &cli.db,
            package.as_deref(),
            file.as_deref(),
            min_score,
            output.as_deref(),
        ),
        Cmd::List { kind } => match kind {
            ListKind::Baselines => baseline::list(&cli.db),
            ListKind::Reports => report::list(&cli.db),
            ListKind::Mutations => tracker_db::list(&cli.db, 20),
        },
    }
}
