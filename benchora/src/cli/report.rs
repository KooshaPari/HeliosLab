//! Report storage + summary for Benchora.
//!
//! Wires the `benchora run` subcommand to actually execute criterion via
//! `cargo bench --bench <name> -- --output-format bencher`. Criterion's
//! "bencher" format emits one JSON object per benchmark on stdout, which
//! we collect, wrap into the canonical Benchora report schema, and
//! persist via the SQLite-backed reports table.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::time_utils;

use crate::cli::baseline::{open_for_read, sha256_via_pub};
use crate::cli::CliError;

/// Canonical report envelope schema id (`BENCH-005` / L29 Monitoring).
/// Soft evidence for auditors: CI and agents can key off this stable string
/// instead of Prometheus/health endpoints (out of scope for a local CLI).
pub const REPORT_SCHEMA_V1: &str = "benchora.report.v1";

/// Required top-level keys on a `benchora.report.v1` envelope.
pub const REPORT_V1_REQUIRED_KEYS: &[&str] = &[
    "schema",
    "suite",
    "created_at",
    "bench_name",
    "benchmarks",
    "host",
];

/// Run a benchmark suite and capture a JSON report to disk.
///
/// Implementation:
/// 1. Resolve the suite name to a `cargo bench --bench <name>` invocation.
/// 2. Pass `-- --output-format bencher` so criterion emits JSON on stdout.
/// 3. Stream stdout line-by-line, parse each non-empty line as a
///    `BencherEstimate`, and accumulate into `Vec<serde_json::Value>`.
/// 4. Wrap the collected entries in the canonical `benchora.report.v1`
///    envelope (suite, created_at, benchmarks, host metadata).
/// 5. Write the envelope to `<out>` (or `<suite>-<timestamp>.json`).
/// 6. Register the report in the SQLite `reports` table.
pub fn run_suite(db: &Path, suite: &str, out: Option<&Path>) -> Result<(), CliError> {
    let now = time_utils::now_iso();
    let out_path: PathBuf = match out {
        Some(p) => p.to_path_buf(),
        None => {
            let stem = format!("{}-{}", suite, sanitize(&now));
            PathBuf::from(format!("{}.json", stem))
        }
    };

    let bench_name = resolve_bench_name(suite)?;
    let entries = run_criterion_bencher(&bench_name)?;

    let body = serde_json::json!({
        "schema": REPORT_SCHEMA_V1,
        "suite": suite,
        "created_at": now,
        "bench_name": bench_name,
        "benchmarks": entries,
        "host": host_metadata(),
        "note": if entries.is_empty() {
            Some("criterion produced no benchmarks — verify the bench file exports a criterion_group")
        } else {
            None
        },
    });

    let pretty = serde_json::to_string_pretty(&body).map_err(|e| CliError::Json {
        path: out_path.clone(),
        source: e,
    })?;
    std::fs::write(&out_path, pretty).map_err(|e| CliError::Io {
        path: out_path.clone(),
        source: e,
    })?;

    // Register in the reports table.
    let conn = open_for_read(db)?;
    let sha = sha256_via_pub(&out_path)?;
    conn.execute(
        r#"INSERT INTO reports(suite, report_path, sha256, created_at)
           VALUES(?,?,?,?)"#,
        rusqlite::params![suite, out_path.to_string_lossy(), sha, now],
    )
    .map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;

    println!(
        "wrote report {} ({} benchmark entries)",
        out_path.display(),
        entries.len()
    );
    Ok(())
}

/// Parse one criterion "bencher"-format JSON line.
fn parse_bencher_line(line: &str) -> Option<serde_json::Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

/// Execute `cargo bench --bench <name> -- --output-format bencher` and
/// collect benchmark entries from stdout.
fn run_criterion_bencher(bench_name: &str) -> Result<Vec<serde_json::Value>, CliError> {
    let mut cmd = Command::new("cargo");
    cmd.args([
        "bench",
        "--bench",
        bench_name,
        "--",
        "--output-format",
        "bencher",
    ]);
    // Keep cargo quiet so the only stdout we parse is criterion's JSON.
    cmd.env("CARGO_TERM_COLOR", "never");

    let output = cmd.output().map_err(|e| {
        CliError::Other(format!(
            "failed to spawn `cargo bench --bench {}`: {} (is cargo on PATH?)",
            bench_name, e
        ))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CliError::Other(format!(
            "cargo bench exited with status {}: {}",
            output.status, stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<serde_json::Value> = stdout.lines().filter_map(parse_bencher_line).collect();
    Ok(entries)
}

/// Map a suite name (e.g. `core`, `mutation`, `property`) to a bench
/// file name. `property`, `contract`, and `spec` route to the rich
/// `phenotype_xdd_lib_bench` harness; `core`, `mutation`, and the
/// raw `my_benchmark` route to the smoke-test bench.
fn resolve_bench_name(suite: &str) -> Result<String, CliError> {
    match suite {
        "property" | "contract" | "spec" => Ok("phenotype_xdd_lib_bench".to_string()),
        "core" | "my_benchmark" | "mutation" => Ok("my_benchmark".to_string()),
        other => Err(CliError::Other(format!(
            "unknown suite '{}' — recognized: core, mutation, property, contract, spec",
            other
        ))),
    }
}

/// Best-effort host metadata (target triple + cpu count) for the report.
fn host_metadata() -> serde_json::Value {
    let target = std::env::var("TARGET").unwrap_or_else(|_| {
        // Cheap fallback: ask rustc.
        Command::new("rustc")
            .args(["-vV"])
            .output()
            .ok()
            .and_then(|o| {
                String::from_utf8(o.stdout).ok().and_then(|s| {
                    s.lines()
                        .find(|l| l.starts_with("host: "))
                        .map(|l| l.trim_start_matches("host: ").to_string())
                })
            })
            .unwrap_or_else(|| "<unknown>".into())
    });
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get() as u64)
        .unwrap_or(1);
    serde_json::json!({ "target": target, "cpus": cpus })
}

/// Summarize a saved report to stdout.
pub fn summarize(path: &Path) -> Result<(), CliError> {
    let raw = std::fs::read_to_string(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| CliError::Json {
        path: path.to_path_buf(),
        source: e,
    })?;
    let suite = v
        .get("suite")
        .and_then(|s| s.as_str())
        .unwrap_or("<unknown>");
    let created = v
        .get("created_at")
        .and_then(|s| s.as_str())
        .unwrap_or("<unknown>");
    let count = v
        .get("benchmarks")
        .and_then(|b| b.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let bench_name = v
        .get("bench_name")
        .and_then(|s| s.as_str())
        .unwrap_or("<unknown>");
    println!("report: {}", path.display());
    println!("  suite      : {}", suite);
    println!("  created_at : {}", created);
    println!("  bench_name : {}", bench_name);
    println!("  benchmarks : {}", count);
    Ok(())
}

/// List stored reports.
pub fn list(db: &Path) -> Result<(), CliError> {
    let conn = open_for_read(db)?;
    let mut stmt = conn
        .prepare("SELECT id, suite, sha256, created_at, report_path FROM reports ORDER BY id DESC LIMIT 200")
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    println!(
        "{:<6} {:<12} {:<14} {:<22} PATH",
        "ID", "SUITE", "SHA256-PREFIX", "CREATED"
    );
    for row in rows {
        let (id, suite, sha, created, path) = row.map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
        println!(
            "{:<6} {:<12} {:<14} {:<22} {}",
            id,
            suite,
            &sha[..12.min(sha.len())],
            created,
            path
        );
    }
    Ok(())
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}
