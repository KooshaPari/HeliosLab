//! Mutation tracking persistence.
//!
//! Mirrors the in-memory [`phenotype_xdd_lib::mutation::MutationTracker`] into
//! a small SQLite table so `benchora mutate` runs are queryable across CI
//! invocations. Mirrors the `connect-and-migrate-on-open` pattern used by
//! `baseline.rs` / `report.rs`.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::cli::CliError;

fn open(db: &Path) -> Result<Connection, CliError> {
    if let Some(parent) = db.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| CliError::Io {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }
    }
    let conn = Connection::open(db).map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS mutation_runs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            suite      TEXT    NOT NULL,
            package    TEXT    NOT NULL,
            file       TEXT,
            output_dir TEXT    NOT NULL,
            total      INTEGER NOT NULL,
            killed     INTEGER NOT NULL,
            survived   INTEGER NOT NULL,
            timeout    INTEGER NOT NULL,
            unviable   INTEGER NOT NULL,
            no_test    INTEGER NOT NULL,
            kill_rate  REAL    NOT NULL,
            min_score  REAL,
            passed     INTEGER NOT NULL,
            created_at TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS mutation_runs_suite_created_at_idx
            ON mutation_runs(suite, created_at DESC);
        "#,
    )
    .map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;
    Ok(conn)
}

/// Outcome of a parsed `cargo mutants` run.
#[derive(Debug, Clone, Copy)]
pub struct RunSummary {
    pub total: u32,
    pub killed: u32,
    pub survived: u32,
    pub timeout: u32,
    pub unviable: u32,
    pub no_test: u32,
}

/// Persist a single mutation run summary and return the inserted row id.
pub fn record(
    db: &Path,
    suite: &str,
    package: &str,
    file: Option<&str>,
    output_dir: &str,
    summary: RunSummary,
    min_score: Option<f64>,
) -> Result<i64, CliError> {
    let conn = open(db)?;
    let kill_rate = if summary.total == 0 {
        // Empty run is treated as 1.0 (no mutants = nothing to fail) so we
        // don't generate spurious "below threshold" failures on trivial
        // crates. The `passed` column still records the verdict for
        // debugging.
        1.0
    } else {
        summary.killed as f64 / summary.total as f64
    };
    let passed = match min_score {
        Some(threshold) if threshold > 0.0 => {
            if kill_rate * 100.0 + f64::EPSILON >= threshold {
                1
            } else {
                0
            }
        }
        _ => 1,
    };
    let now = super::time_utils::now_iso();
    conn.execute(
        r#"INSERT INTO mutation_runs(
              suite, package, file, output_dir,
              total, killed, survived, timeout, unviable, no_test,
              kill_rate, min_score, passed, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#,
        params![
            suite,
            package,
            file,
            output_dir,
            summary.total as i64,
            summary.killed as i64,
            summary.survived as i64,
            summary.timeout as i64,
            summary.unviable as i64,
            summary.no_test as i64,
            kill_rate,
            min_score,
            passed,
            now,
        ],
    )
    .map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;
    Ok(conn.last_insert_rowid())
}

/// Most-recent run summary for a given (suite, package) — used for
/// `benchora list mutations`.
#[derive(Debug, Clone)]
pub struct LatestRun {
    pub suite: String,
    pub package: String,
    pub file: Option<String>,
    pub output_dir: String,
    pub total: u32,
    pub killed: u32,
    pub survived: u32,
    pub timeout: u32,
    pub unviable: u32,
    pub no_test: u32,
    pub kill_rate: f64,
    pub min_score: Option<f64>,
    pub passed: bool,
    pub created_at: String,
}

pub fn latest_for(db: &Path, suite: &str, package: &str) -> Result<Option<LatestRun>, CliError> {
    let conn = open(db)?;
    let mut stmt = conn
        .prepare(
            "SELECT suite, package, file, output_dir, total, killed, survived,
                    timeout, unviable, no_test, kill_rate, min_score, passed,
                    created_at
             FROM mutation_runs
             WHERE suite = ? AND package = ?
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    let row = stmt
        .query_row(params![suite, package], |r| {
            Ok(LatestRun {
                suite: r.get(0)?,
                package: r.get(1)?,
                file: r.get::<_, Option<String>>(2)?,
                output_dir: r.get(3)?,
                total: r.get::<_, i64>(4)? as u32,
                killed: r.get::<_, i64>(5)? as u32,
                survived: r.get::<_, i64>(6)? as u32,
                timeout: r.get::<_, i64>(7)? as u32,
                unviable: r.get::<_, i64>(8)? as u32,
                no_test: r.get::<_, i64>(9)? as u32,
                kill_rate: r.get(10)?,
                min_score: r.get::<_, Option<f64>>(11)?,
                passed: r.get::<_, i64>(12)? != 0,
                created_at: r.get(13)?,
            })
        })
        .optional()
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    Ok(row)
}

/// Pretty-print the most recent N runs across all suites/packages.
pub fn list(db: &Path, limit: u32) -> Result<(), CliError> {
    let conn = open(db)?;
    let mut stmt = conn
        .prepare(
            "SELECT suite, package, total, killed, kill_rate,
                    COALESCE(min_score, 0.0), passed, created_at
             FROM mutation_runs
             ORDER BY created_at DESC
             LIMIT ?",
        )
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)? as u32,
                r.get::<_, i64>(3)? as u32,
                r.get::<_, f64>(4)? * 100.0,
                r.get::<_, f64>(5)?,
                r.get::<_, i64>(6)? != 0,
                r.get::<_, String>(7)?,
            ))
        })
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    println!(
        "{:<14} {:<16} {:>5} {:>5} {:>7} {:>7} {:<6} CREATED",
        "SUITE", "PACKAGE", "TOTAL", "KILLED", "KILL%", "THRESH%", "PASS",
    );
    for row in rows {
        let (suite, package, total, killed, kill_pct, threshold, passed, created) =
            row.map_err(|e| CliError::Db {
                path: db.to_path_buf(),
                source: e,
            })?;
        println!(
            "{:<14} {:<16} {:>5} {:>5} {:>6.2}% {:>6.2}% {:<6} {}",
            suite,
            package,
            total,
            killed,
            kill_pct,
            threshold,
            if passed { "PASS" } else { "FAIL" },
            created,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn record_and_query_roundtrip() {
        let tmp = tempdir().expect("tempdir");
        let db = tmp.path().join("mutations.db");
        let summary = RunSummary {
            total: 10,
            killed: 8,
            survived: 1,
            timeout: 0,
            unviable: 1,
            no_test: 0,
        };
        let id = record(
            &db,
            "core",
            "benchora",
            Some("src/lib.rs"),
            "mutants-out",
            summary,
            Some(75.0),
        )
        .expect("record");
        assert!(id > 0);

        let latest = latest_for(&db, "core", "benchora")
            .expect("query")
            .expect("present");
        assert_eq!(latest.total, 10);
        assert_eq!(latest.killed, 8);
        assert!(latest.kill_rate > 0.79 && latest.kill_rate < 0.81);
        assert!(latest.passed); // 80.0% >= 75%
    }

    #[test]
    fn empty_run_with_threshold_records_pass() {
        let tmp = tempdir().expect("tempdir");
        let db = tmp.path().join("mutations.db");
        let summary = RunSummary {
            total: 0,
            killed: 0,
            survived: 0,
            timeout: 0,
            unviable: 0,
            no_test: 0,
        };
        record(&db, "core", "benchora", None, "out", summary, Some(75.0)).expect("record");
        let latest = latest_for(&db, "core", "benchora")
            .expect("query")
            .expect("present");
        assert!(latest.passed);
        assert_eq!(latest.kill_rate, 1.0);
    }
}
