//! Baseline storage for Benchora.
//!
//! Backed by a small SQLite table that records `(name, sha256, created_at,
//! suite, report_path)`. The actual report JSON is stored on disk; this
//! module only tracks the metadata + integrity hash.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::cli::CliError;

use super::time_utils;

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
        CREATE TABLE IF NOT EXISTS baselines (
            name        TEXT PRIMARY KEY,
            suite       TEXT NOT NULL,
            report_path TEXT NOT NULL,
            sha256      TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            suite       TEXT NOT NULL,
            report_path TEXT NOT NULL,
            sha256      TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;
    Ok(conn)
}

fn sha256_file(path: &Path) -> Result<String, CliError> {
    sha256_via_pub(path)
}

pub use super::time_utils::{epoch_to_ymdhms, now_iso};

/// Public re-export of the file-hash helper for cross-module reuse.
pub fn sha256_via_pub(path: &Path) -> Result<String, CliError> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = f.read(&mut buf).map_err(|e| CliError::Io {
            path: path.to_path_buf(),
            source: e,
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    // Build the lowercase hex string byte-by-byte. Both bare `GenericArray`
    // and `&[u8]` lost their `LowerHex` impl on current `generic-array` /
    // stable-rustc, so iterate the individual bytes which DO impl it.
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Promote a report to a named baseline.
pub fn promote(db: &Path, name: &str, from: &Path) -> Result<(), CliError> {
    let conn = open(db)?;
    let payload = std::fs::read_to_string(from).map_err(|e| CliError::Io {
        path: from.to_path_buf(),
        source: e,
    })?;
    let suite = extract_suite(&payload).unwrap_or_else(|| "unknown".into());
    let sha = sha256_file(from)?;
    let now = time_utils::now_iso();
    conn.execute(
        r#"INSERT INTO baselines(name, suite, report_path, sha256, created_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET
             suite=excluded.suite,
             report_path=excluded.report_path,
             sha256=excluded.sha256,
             created_at=excluded.created_at"#,
        params![name, suite, from.to_string_lossy(), sha, now],
    )
    .map_err(|e| CliError::Db {
        path: db.to_path_buf(),
        source: e,
    })?;
    println!(
        "baseline {name} -> {report} (sha256={sha})",
        name = name,
        report = from.display(),
        sha = &sha[..12]
    );
    Ok(())
}

/// List stored baselines.
pub fn list(db: &Path) -> Result<(), CliError> {
    let conn = open(db)?;
    let mut stmt = conn
        .prepare("SELECT name, suite, sha256, created_at, report_path FROM baselines ORDER BY created_at DESC")
        .map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
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
        "{:<24} {:<12} {:<14} {:<22} PATH",
        "NAME", "SUITE", "SHA256-PREFIX", "CREATED"
    );
    for row in rows {
        let (name, suite, sha, created, path) = row.map_err(|e| CliError::Db {
            path: db.to_path_buf(),
            source: e,
        })?;
        println!(
            "{:<24} {:<12} {:<14} {:<22} {}",
            name,
            suite,
            &sha[..12.min(sha.len())],
            created,
            path
        );
    }
    Ok(())
}

fn extract_suite(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("suite")?.as_str().map(|s| s.to_string())
}

// Re-export for use by report::list.
pub fn open_for_read(db: &Path) -> Result<Connection, CliError> {
    open(db)
}
