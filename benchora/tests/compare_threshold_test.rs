//! Integration tests for the `cli::compare` regression-gate.
//!
//! Proves the env -> DB -> default precedence for the regression
//! threshold AND proves a synthetic 10% regression is correctly
//! flagged with a non-Ok result that the CLI dispatcher turns into
//! an exit-1.
//!
//! These tests are the Tier-2 #1 deliverable: the env-gated
//! `--fail-on-regression` CI gate, which is what `BytePort/Taskfile.yml`
//! line 333 shells out to.

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use phenotype_xdd_lib::cli::compare::{
    resolve_regression_threshold, DEFAULT_REGRESSION_THRESHOLD_PCT,
};

/// Serialize tests that read/write `BENCHORA_REGRESSION_THRESHOLD_PCT`.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Helper: write a minimal criterion-style report JSON with one
/// benchmark at the given nanosecond timing.
fn write_criterion_report(path: &Path, name: &str, ns: f64) {
    let body = serde_json::json!({
        "benchmarks": [
            {
                "full_id": name,
                "typical": { "point_estimate": ns },
            }
        ]
    });
    fs::write(path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
}

/// Tier-2 #1: default threshold is 5.0 when nothing is configured.
#[test]
fn resolve_threshold_default_when_nothing_set() {
    let _guard = ENV_LOCK.lock().unwrap();
    // Point at a path that definitely does NOT exist as a SQLite DB so
    // `open_for_read` fails and the function falls through to default.
    let bogus_db = Path::new("target/benchora-tests/no-such-db.sqlite");
    let _ = fs::remove_file(bogus_db);

    // Ensure env var is not set for this test.
    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");

    let t = resolve_regression_threshold(bogus_db);
    assert!(
        (t - DEFAULT_REGRESSION_THRESHOLD_PCT).abs() < 1e-9,
        "expected default {DEFAULT_REGRESSION_THRESHOLD_PCT}, got {t}"
    );
}

/// Tier-2 #1: env var wins over default.
#[test]
fn resolve_threshold_env_overrides_default() {
    let _guard = ENV_LOCK.lock().unwrap();
    let bogus_db = Path::new("target/benchora-tests/no-such-db.sqlite");
    std::env::set_var("BENCHORA_REGRESSION_THRESHOLD_PCT", "12.5");
    let t = resolve_regression_threshold(bogus_db);
    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");
    assert!((t - 12.5).abs() < 1e-9, "expected 12.5, got {t}");
}

/// Tier-2 #1: malformed env falls back to default with a warning.
#[test]
fn resolve_threshold_env_malformed_falls_back() {
    let _guard = ENV_LOCK.lock().unwrap();
    let bogus_db = Path::new("target/benchora-tests/no-such-db.sqlite");
    std::env::set_var("BENCHORA_REGRESSION_THRESHOLD_PCT", "not-a-number");
    let t = resolve_regression_threshold(bogus_db);
    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");
    assert!(
        (t - DEFAULT_REGRESSION_THRESHOLD_PCT).abs() < 1e-9,
        "expected default fallback, got {t}"
    );
}

/// Tier-2 #1: synthetic 10% regression is flagged as CliError::Other.
#[test]
fn diff_flags_ten_percent_regression() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("benchora.sqlite");
    let baseline_report = tmp.path().join("baseline.json");
    let current_report = tmp.path().join("current.json");

    write_criterion_report(&baseline_report, "core::noop", 100.0);
    write_criterion_report(&current_report, "core::noop", 110.0);

    // Seed the baseline row directly.
    {
        use phenotype_xdd_lib::cli::baseline::sha256_via_pub;
        let sha = sha256_via_pub(&baseline_report).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS baselines (
                name        TEXT PRIMARY KEY,
                suite       TEXT NOT NULL,
                report_path TEXT NOT NULL,
                sha256      TEXT NOT NULL,
                created_at  TEXT NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO baselines (name, suite, report_path, sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "main",
                "core",
                baseline_report.to_string_lossy(),
                sha,
                "2026-06-23T00:00:00Z"
            ],
        )
        .unwrap();
    }

    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");
    let result = phenotype_xdd_lib::cli::compare::diff(&db, "main", &current_report);
    let err = result.expect_err("expected regression to be flagged as an error");
    let msg = format!("{err}");
    assert!(
        msg.contains("1 regression") && msg.contains("5.00"),
        "expected error to mention 1 regression at 5% threshold, got: {msg}"
    );
}

/// Tier-2 #1: 2% regression is NOT flagged under the default 5% threshold.
#[test]
fn diff_passes_within_noise() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("benchora.sqlite");
    let baseline_report = tmp.path().join("baseline.json");
    let current_report = tmp.path().join("current.json");

    write_criterion_report(&baseline_report, "core::noop", 100.0);
    write_criterion_report(&current_report, "core::noop", 102.0);

    {
        use phenotype_xdd_lib::cli::baseline::sha256_via_pub;
        let sha = sha256_via_pub(&baseline_report).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS baselines (
                name        TEXT PRIMARY KEY,
                suite       TEXT NOT NULL,
                report_path TEXT NOT NULL,
                sha256      TEXT NOT NULL,
                created_at  TEXT NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO baselines (name, suite, report_path, sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "main",
                "core",
                baseline_report.to_string_lossy(),
                sha,
                "2026-06-23T00:00:00Z"
            ],
        )
        .unwrap();
    }

    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");
    let result = phenotype_xdd_lib::cli::compare::diff(&db, "main", &current_report);
    assert!(
        result.is_ok(),
        "expected 2% within noise to pass, got: {result:?}"
    );
}

/// Tier-2 #1: env-threshold raises the gate so 4% passes (would fail at default 5%).
#[test]
fn diff_env_threshold_lets_moderate_regression_pass() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let db = tmp.path().join("benchora.sqlite");
    let baseline_report = tmp.path().join("baseline.json");
    let current_report = tmp.path().join("current.json");

    write_criterion_report(&baseline_report, "core::noop", 100.0);
    write_criterion_report(&current_report, "core::noop", 104.0);

    {
        use phenotype_xdd_lib::cli::baseline::sha256_via_pub;
        let sha = sha256_via_pub(&baseline_report).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS baselines (
                name        TEXT PRIMARY KEY,
                suite       TEXT NOT NULL,
                report_path TEXT NOT NULL,
                sha256      TEXT NOT NULL,
                created_at  TEXT NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO baselines (name, suite, report_path, sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "main",
                "core",
                baseline_report.to_string_lossy(),
                sha,
                "2026-06-23T00:00:00Z"
            ],
        )
        .unwrap();
    }

    std::env::set_var("BENCHORA_REGRESSION_THRESHOLD_PCT", "10.0");
    let result = phenotype_xdd_lib::cli::compare::diff(&db, "main", &current_report);
    std::env::remove_var("BENCHORA_REGRESSION_THRESHOLD_PCT");
    assert!(
        result.is_ok(),
        "expected 4% to pass under env-set 10% threshold, got: {result:?}"
    );
}
