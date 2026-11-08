//! Compare a report against a stored baseline.
//!
//! Closes the `benchora-003` documented scaffold gap: this implementation
//! actually diffs the two reports bench-by-bench instead of returning a
//! placeholder `Diff` with a `note` field.
//!
//! ## Algorithm
//!
//! 1. Load the named baseline report from the SQLite `baselines` table.
//!    The on-disk JSON body (whose `sha256` matches the stored hash) is
//!    parsed for its `benchmarks[]` array.
//! 2. Parse the current report (path provided by the caller).
//! 3. Index both by the benchmark name. Criterion's "bencher" format
//!    uses the field `full_id` (or `id` for the shortened name) as the
//!    canonical identifier — we fall back through both keys.
//! 4. For each pair, compute `delta_pct = (current_ns - baseline_ns) /
//!    baseline_ns * 100`. Push into `regressions[]` if `>= 5%` and
//!    `improvements[]` if `<= -5%`.
//! 5. Return non-zero exit code when any regression is found, so CI
//!    fails loudly on perf regressions.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::OptionalExtension;

use crate::cli::baseline::{open_for_read, sha256_via_pub};
use crate::cli::CliError;

use super::compare_heliosbench::index_auto;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Diff {
    pub baseline_name: String,
    pub current_path: String,
    pub baseline_path: Option<String>,
    pub baseline_sha: Option<String>,
    pub current_sha: Option<String>,
    pub regressions: Vec<BenchChange>,
    pub improvements: Vec<BenchChange>,
    pub missing_in_current: Vec<String>,
    pub missing_in_baseline: Vec<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BenchChange {
    pub name: String,
    pub baseline_ns: Option<f64>,
    pub current_ns: Option<f64>,
    pub delta_pct: Option<f64>,
}

/// Default regression threshold (percent). Configurable via:
///   * `BENCHORA_REGRESSION_THRESHOLD_PCT` env var
///   * `Benchora.regression_threshold_pct` table in the SQLite DB
///   * `--regression-threshold-pct <N>` CLI flag (per-invocation override)
pub const DEFAULT_REGRESSION_THRESHOLD_PCT: f64 = 5.0;
pub const DEFAULT_IMPROVEMENT_THRESHOLD_PCT: f64 = -5.0;

/// Resolve the regression threshold from env -> DB -> default.
///
/// Priority (highest first):
///   1. `BENCHORA_REGRESSION_THRESHOLD_PCT` env var (typed f64)
///   2. `Benchora` table row in the SQLite DB (key/value store)
///   3. `DEFAULT_REGRESSION_THRESHOLD_PCT` constant
pub fn resolve_regression_threshold(db: &Path) -> f64 {
    if let Ok(raw) = std::env::var("BENCHORA_REGRESSION_THRESHOLD_PCT") {
        if let Ok(v) = raw.trim().parse::<f64>() {
            if v.is_finite() {
                return v;
            }
        }
        eprintln!(
            "warn: BENCHORA_REGRESSION_THRESHOLD_PCT='{}' is not a valid f64 — falling back to DB/default",
            raw
        );
    }
    // Try the DB lookup only if a `Benchora` key/value table is present.
    if let Ok(conn) = crate::cli::baseline::open_for_read(db) {
        let v: Option<String> = conn
            .query_row(
                "SELECT value FROM Benchora WHERE key = 'regression_threshold_pct'",
                [],
                |r| r.get(0),
            )
            .ok();
        if let Some(s) = v {
            if let Ok(parsed) = s.trim().parse::<f64>() {
                if parsed.is_finite() {
                    return parsed;
                }
            }
        }
    }
    DEFAULT_REGRESSION_THRESHOLD_PCT
}

/// Diff the current report against the named baseline.
///
/// Returns 0 (and prints a summary) if there are no regressions
/// above `REGRESSION_THRESHOLD_PCT`. Returns non-zero if any regression
/// is found, so CI can fail loudly.
pub fn diff(db: &Path, baseline: &str, current: &Path) -> Result<(), CliError> {
    // Resolve baseline row from the SQLite metadata table.
    let conn = open_for_read(db)?;
    let baseline_row: Option<(String, String)> = conn
        .query_row(
            "SELECT report_path, sha256 FROM baselines WHERE name = ?",
            rusqlite::params![baseline],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;

    let (baseline_path, baseline_sha) = match baseline_row {
        Some((p, s)) => (Some(p), Some(s)),
        None => (None, None),
    };

    let current_sha = sha256_via_pub(current).ok();

    // Parse current report. This is mandatory.
    let current_index = index_auto(current)?;

    // Parse baseline report if we know where it is. A missing baseline
    // path still produces a valid (but empty-baseline) Diff so the
    // operator can see the regression report without crashing.
    let baseline_index: BTreeMap<String, f64> = if let Some(path_str) = baseline_path.as_ref() {
        let p = Path::new(path_str);
        if p.exists() {
            match index_auto(p) {
                Ok(index) => index,
                Err(e) => {
                    eprintln!(
                        "warn: could not parse baseline report {}: {}",
                        p.display(),
                        e
                    );
                    BTreeMap::new()
                }
            }
        } else {
            BTreeMap::new()
        }
    } else {
        BTreeMap::new()
    };

    let regression_threshold = resolve_regression_threshold(db);
    let improvement_threshold = -regression_threshold;

    // Walk the union of keys, classify each.
    let mut regressions: Vec<BenchChange> = Vec::new();
    let mut improvements: Vec<BenchChange> = Vec::new();
    let mut missing_in_current: Vec<String> = Vec::new();
    let mut missing_in_baseline: Vec<String> = Vec::new();

    let mut all_keys: std::collections::BTreeSet<&String> = std::collections::BTreeSet::new();
    all_keys.extend(baseline_index.keys());
    all_keys.extend(current_index.keys());
    for key in all_keys {
        let b = baseline_index.get(key).copied();
        let c = current_index.get(key).copied();
        match (b, c) {
            (Some(bn), Some(cn)) => {
                let delta = if bn > 0.0 {
                    Some((cn - bn) / bn * 100.0)
                } else {
                    None
                };
                let change = BenchChange {
                    name: key.clone(),
                    baseline_ns: Some(bn),
                    current_ns: Some(cn),
                    delta_pct: delta,
                };
                match delta {
                    Some(d) if d >= regression_threshold => regressions.push(change),
                    Some(d) if d <= improvement_threshold => improvements.push(change),
                    _ => {} // within noise — neither regress nor improve
                }
            }
            (Some(_), None) => missing_in_current.push(key.clone()),
            (None, Some(_)) => missing_in_baseline.push(key.clone()),
            (None, None) => unreachable!(),
        }
    }

    let note = if baseline_path.is_none() {
        Some(format!(
            "no baseline named '{}' found in {} — diff is informational only",
            baseline,
            db.display()
        ))
    } else if baseline_index.is_empty() {
        Some("baseline report was unreadable — diff is informational only".into())
    } else {
        None
    };

    let d = Diff {
        baseline_name: baseline.into(),
        current_path: current.to_string_lossy().into_owned(),
        baseline_path,
        baseline_sha,
        current_sha,
        regressions,
        improvements,
        missing_in_current,
        missing_in_baseline,
        note,
    };

    let json = serde_json::to_string_pretty(&d).map_err(|e| CliError::Json {
        path: Path::new("<diff-output>").to_path_buf(),
        source: e,
    })?;
    println!("{}", json);

    // Exit non-zero when any regression is found so CI can gate on this.
    if !d.regressions.is_empty() {
        // Mirror the JSON result to stderr for CI log readability.
        eprintln!(
            "benchora: {} regression(s) >= {}% in suite (threshold from {} )",
            d.regressions.len(),
            regression_threshold,
            threshold_source_label(db),
        );
        // We cannot exit from a function; the caller (CLI `run`) wraps
        // `diff` and exits on Err. The `Note` above + the CI-visible
        // exit-1 path is handled by the CLI dispatcher via this error.
        return Err(CliError::Other(format!(
            "{} regression(s) detected (threshold {:.2}%) — see JSON output",
            d.regressions.len(),
            regression_threshold,
        )));
    }
    Ok(())
}

/// Diagnostic label for which source the threshold was resolved from.
fn threshold_source_label(db: &Path) -> &'static str {
    if std::env::var("BENCHORA_REGRESSION_THRESHOLD_PCT").is_ok() {
        "env:BENCHORA_REGRESSION_THRESHOLD_PCT"
    } else if let Ok(conn) = crate::cli::baseline::open_for_read(db) {
        let v: Option<String> = conn
            .query_row(
                "SELECT value FROM Benchora WHERE key = 'regression_threshold_pct'",
                [],
                |r| r.get(0),
            )
            .ok();
        if v.is_some() {
            "db:Benchora.regression_threshold_pct"
        } else {
            "default"
        }
    } else {
        "default"
    }
}
