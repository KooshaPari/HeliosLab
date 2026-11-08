//! Mutation testing CLI: real `cargo mutants` executor + parser.
//!
//! Walks the work the original PR (#65) stub promised:
//! 1. Spawn `cargo mutants --output <dir> --no-shuffle --jobs 2 [--package ...]
//!    [--file ...]` and capture stdout/stderr + exit status.
//! 2. Parse `outcomes.json` from cargo-mutants 27.x. cargo-mutants nests its
//!    artifacts at `<output>/mutants.out/`; the summary file lives at
//!    `<output>/mutants.out/outcomes.json`. The schema is `Vec<Outcome>`
//!    where each outcome carries either `scenario: "Baseline"` or
//!    `scenario: { Mutant: { name, package, file, replacement, genre } }`
//!    plus a `summary` discriminator of `"CaughtMutant" | "MissedMutant" |
//!    "Unviable" | "Timeout" | "Success" | "Failure"`.
//! 3. Roll those into a [`tracker_db::RunSummary`] and persist via
//!    [`tracker_db::record`] so the run is queryable later
//!    (`benchora list mutations`).
//! 4. Enforce the user-supplied `--min-score` threshold. Below threshold the
//!    function returns a [`CliError::Other`] so the binary exits non-zero —
//!    exactly what `bench-gate.yml` needs to fail the gate.
//!
//! Threshold enforcement lives entirely in the local parser + tracker_db
//! layer; cargo-mutants 27.x removed `--minimum-pass-rate`, so we never
//! forward a threshold flag to the cargo-mutants binary.
//!
//! [`tracker_db::RunSummary`]: crate::cli::tracker_db::RunSummary
//! [`tracker_db::record`]: crate::cli::tracker_db::record
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cli::error::CliError;
use crate::cli::mutate_parse;
use crate::cli::tracker_db;

/// Run mutation testing against `--package` / `--file` and persist the
/// results. Returns `Err(CliError::Other)` if `--min-score` is set and the
/// measured kill-rate falls below the threshold.
pub fn run(
    db: &Path,
    package: Option<&str>,
    file: Option<&Path>,
    min_score: Option<f64>,
    output: Option<&Path>,
) -> Result<(), CliError> {
    let output_dir: PathBuf = match output {
        Some(p) => p.to_path_buf(),
        None => PathBuf::from("mutants-out"),
    };
    std::fs::create_dir_all(&output_dir).map_err(|e| CliError::Io {
        path: output_dir.clone(),
        source: e,
    })?;

    let mut cmd = Command::new("cargo");
    cmd.arg("mutants")
        .arg("--no-shuffle")
        .arg("--jobs")
        .arg("2")
        .arg("--output")
        .arg(&output_dir);
    if let Some(pkg) = package {
        cmd.arg("--package").arg(pkg);
    }
    // Note: cargo-mutants 27.x does not accept --minimum-pass-rate
    // (removed/renamed upstream). Threshold enforcement lives entirely in
    // the local parser + tracker_db layer below so the gate stays robust
    // across cargo-mutants versions.
    // Per-file scope is `--file <relative/path>` in cargo-mutants; we
    // accept it as a trailing arg after `--`.
    if let Some(f) = file {
        cmd.arg("--file").arg(f);
    }

    eprintln!(
        "[benchora mutate] running: cargo {}",
        cmd.get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    );

    let status = cmd
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status()
        .map_err(|source| {
            // Translating "binary not found" into a friendlier error so the
            // gate output surfaces the actual remediation (install cargo-mutants).
            if source.kind() == std::io::ErrorKind::NotFound
                || source.raw_os_error() == Some(2)
            {
                CliError::Other(
                    "cargo-mutants not installed -- install with `cargo install --locked cargo-mutants`"
                        .to_string(),
                )
            } else {
                CliError::Io {
                    path: PathBuf::from("cargo"),
                    source,
                }
            }
        })?;

    let parsed = mutate_parse::parse_mutants_dir(&output_dir)?;
    let file_owned: Option<String> = file.map(|f| f.to_string_lossy().into_owned());
    tracker_db::record(
        db,
        "mutation",
        package.unwrap_or("."),
        file_owned.as_deref(),
        output_dir.to_string_lossy().as_ref(),
        parsed,
        min_score,
    )?;

    let latest = tracker_db::latest_for(db, "mutation", package.unwrap_or("."))?
        .ok_or_else(|| CliError::Other("mutation row missing after insert".into()))?;
    print_report(&latest, parsed);

    // The locally-computed threshold is authoritative so the gate stays
    // stable even when the runner's verdict and ours disagree.
    if let Some(threshold) = min_score {
        let pct = latest.kill_rate * 100.0;
        if pct + f64::EPSILON < threshold {
            return Err(CliError::Other(format!(
                "mutation kill-rate {pct:.2}% below --min-score {threshold:.2}%"
            )));
        }
    }

    if !status.success() && min_score.is_none() && parsed.total == 0 {
        return Err(CliError::Other(format!(
            "cargo mutants exited with {status} (no viable mutations parsed)"
        )));
    }

    Ok(())
}

fn print_report(latest: &tracker_db::LatestRun, summary: tracker_db::RunSummary) {
    println!(
        "[benchora mutate] package={} total={} killed={} survived={} timeout={} unviable={} no_test={} kill-rate={:.2}%",
        latest.package,
        summary.total,
        summary.killed,
        summary.survived,
        summary.timeout,
        summary.unviable,
        summary.no_test,
        latest.kill_rate * 100.0,
    );
    if let Some(t) = latest.min_score {
        let verdict = if latest.passed { "PASS" } else { "FAIL" };
        println!("[benchora mutate] threshold={:.2}% verdict={}", t, verdict);
    }
    println!(
        "[benchora mutate] persisted at {} (db output_dir={})",
        latest.created_at, latest.output_dir,
    );
}
