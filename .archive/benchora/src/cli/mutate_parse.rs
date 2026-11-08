//! Parsers for `cargo mutants` output formats.
//!
//! Handles three layout generations:
//! * **27.x nested**: `<output>/mutants.out/outcomes.json`
//! * **Flat fallback**: `<output>/outcomes.json`
//! * **Legacy summary**: `<output>/summary.json` (pre-26.x)
//! * **Per-mutation files**: `<output>/mutations/*.json`

use std::path::Path;

use crate::cli::error::CliError;
use crate::cli::tracker_db::RunSummary;

/// Parse the output directory produced by `cargo mutants` 27.x.
///
/// cargo-mutants 27.x nests its artifacts at `<output>/mutants.out/`:
///
///   * `outcomes.json`  -- full outcome list (baseline + every mutant).
///   * `caught.txt`     -- names of mutants that were caught.
///   * `missed.txt`     -- names of mutants that survived.
///   * `unviable.txt`   -- names that failed to build.
///   * `timeout.txt`    -- names that timed out.
///   * `mutants.json`   -- list of generated mutants (with diffs).
///
/// `outcomes.json` is the source of truth; the .txt files are simple
/// line-delimited fallback summaries that we accept for older / future
/// cargo-mutants versions.
///
/// This function is permissive: if it finds `outcomes.json` it uses it;
/// otherwise it walks `<output>/mutants.out/` for `*.json` files; otherwise
/// it returns a descriptive error.
pub(crate) fn parse_mutants_dir(dir: &Path) -> Result<RunSummary, CliError> {
    // 1. cargo-mutants 27.x canonical: <output>/mutants.out/outcomes.json
    let nested_outcomes = dir.join("mutants.out").join("outcomes.json");
    if nested_outcomes.exists() {
        return parse_outcomes_json(&nested_outcomes);
    }

    // 2. Older / fallback: <output>/outcomes.json
    let flat_outcomes = dir.join("outcomes.json");
    if flat_outcomes.exists() {
        return parse_outcomes_json(&flat_outcomes);
    }

    // 3. Legacy: <output>/summary.json (cargo-mutants <26.x)
    let legacy_summary = dir.join("summary.json");
    if legacy_summary.exists() {
        return parse_legacy_summary(&legacy_summary);
    }

    // 4. Per-mutation .json fallback in <output>/mutations/
    if let Some(summary) = aggregate_per_mutation_files(&dir.join("mutations")) {
        return Ok(summary);
    }

    Err(CliError::Other(format!(
        "cargo mutants produced no output in {} -- verify cargo-mutants is installed and produced a non-empty run",
        dir.display()
    )))
}

/// Parse a cargo-mutants 27.x `outcomes.json` (Vec of `{scenario, summary}`).
fn parse_outcomes_json(path: &Path) -> Result<RunSummary, CliError> {
    let bytes = std::fs::read(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;

    // We only care about per-outcome `summary` for kill-rate math, so we
    // deserialize `scenario` as an opaque `serde_json::Value`. That lets
    // us accept both cargo-mutants 27.x shapes:
    //   * `"scenario": "Baseline"`               (string)
    //   * `"scenario": { "Mutant": { ... } }`    (object wrapper)
    // The baseline scenario reports `summary == "Success"` and is
    // therefore naturally excluded from the counters below.
    //
    // The 27.x file wraps the array at the top level:
    //   { "outcomes": [ { scenario, summary, ... }, ... ] }
    // Earlier / future versions may write a bare array; we accept both.
    #[derive(serde::Deserialize)]
    struct OutcomesFile {
        outcomes: Vec<Outcome>,
    }
    #[derive(serde::Deserialize)]
    struct Outcome {
        #[allow(dead_code)]
        scenario: serde_json::Value,
        summary: String,
    }

    let outcomes: Vec<Outcome> = match serde_json::from_slice::<OutcomesFile>(&bytes) {
        Ok(of) => of.outcomes,
        Err(_) => {
            serde_json::from_slice::<Vec<Outcome>>(&bytes).map_err(|source| CliError::Json {
                path: path.to_path_buf(),
                source,
            })?
        }
    };

    let mut killed = 0u32;
    let mut survived = 0u32;
    let mut timeout = 0u32;
    let mut unviable = 0u32;
    let mut no_test = 0u32;

    for o in outcomes {
        // Baseline reports "Success" / "Failure"; mutations report one of
        // the discriminator strings below.
        match o.summary.as_str() {
            "CaughtMutant" | "Caught" | "killed" => killed += 1,
            "MissedMutant" | "Missed" | "survived" => survived += 1,
            "Timeout" | "timeout" => timeout += 1,
            "Unviable" | "unviable" => unviable += 1,
            "NoTest" | "no_test" => no_test += 1,
            _ => {} // "Success" / "Failure" / unknown baseline / skipped
        }
    }
    let total = killed + survived + timeout + unviable + no_test;
    if total == 0 {
        return Err(CliError::Other(format!(
            "cargo mutants produced no viable mutations in {}",
            path.display()
        )));
    }

    Ok(RunSummary {
        total,
        killed,
        survived,
        timeout,
        unviable,
        no_test,
    })
}

/// Parse a pre-26.x `summary.json` (the old aggregated form).
fn parse_legacy_summary(path: &Path) -> Result<RunSummary, CliError> {
    let bytes = std::fs::read(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    #[derive(serde::Deserialize)]
    struct CargoMutantsOutcome {
        killed: u32,
        survived: u32,
        timeout: u32,
        unviable: u32,
        no_test: u32,
    }
    #[derive(serde::Deserialize)]
    struct CargoMutantsSummary {
        outcomes: CargoMutantsOutcome,
    }
    let parsed: CargoMutantsSummary =
        serde_json::from_slice(&bytes).map_err(|source| CliError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    let total = parsed.outcomes.killed
        + parsed.outcomes.survived
        + parsed.outcomes.timeout
        + parsed.outcomes.unviable
        + parsed.outcomes.no_test;
    Ok(RunSummary {
        total,
        killed: parsed.outcomes.killed,
        survived: parsed.outcomes.survived,
        timeout: parsed.outcomes.timeout,
        unviable: parsed.outcomes.unviable,
        no_test: parsed.outcomes.no_test,
    })
}

/// Aggregate per-mutation JSON files (legacy / non-canonical output).
fn aggregate_per_mutation_files(subdir: &Path) -> Option<RunSummary> {
    let entries = std::fs::read_dir(subdir).ok()?;
    let mut total = 0u32;
    let mut killed = 0u32;
    let mut survived = 0u32;
    let mut timeout = 0u32;
    let mut unviable = 0u32;
    let mut no_test = 0u32;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&p).ok()?;
        #[derive(serde::Deserialize)]
        struct OneMutation {
            status: String,
        }
        if let Ok(m) = serde_json::from_slice::<OneMutation>(&bytes) {
            total += 1;
            match m.status.as_str() {
                "killed" | "CaughtMutant" => killed += 1,
                "survived" | "MissedMutant" => survived += 1,
                "timeout" | "Timeout" => timeout += 1,
                "unviable" | "Unviable" => unviable += 1,
                "no_test" | "NoTest" => no_test += 1,
                _ => {}
            }
        }
    }
    if total == 0 {
        return None;
    }
    Some(RunSummary {
        total,
        killed,
        survived,
        timeout,
        unviable,
        no_test,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_outcomes_json(dir: &Path, outcomes: serde_json::Value) {
        let nested = dir.join("mutants.out");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("outcomes.json"),
            serde_json::to_vec(&outcomes).unwrap(),
        )
        .unwrap();
    }

    fn write_flat_outcomes_json(dir: &Path, outcomes: serde_json::Value) {
        fs::write(
            dir.join("outcomes.json"),
            serde_json::to_vec(&outcomes).unwrap(),
        )
        .unwrap();
    }

    fn write_legacy_summary(dir: &Path, outcomes: serde_json::Value) {
        let body = serde_json::json!({
            "schema_version": 1,
            "outcomes": outcomes,
        });
        fs::write(dir.join("summary.json"), serde_json::to_vec(&body).unwrap()).unwrap();
    }

    #[test]
    fn parses_27x_outcomes_json_with_nested_layout() {
        let tmp = tempdir().unwrap();
        let outcomes = serde_json::json!([
            { "scenario": "Baseline", "summary": "Success" },
            {
                "scenario": { "Mutant": {
                    "name": "src/lib.rs:1:1: replace foo with ()",
                    "package": "benchora",
                    "file": "src/lib.rs",
                    "replacement": "()",
                    "genre": "FnValue",
                }},
                "summary": "CaughtMutant",
            },
            {
                "scenario": { "Mutant": {
                    "name": "src/lib.rs:2:1: replace bar with ()",
                    "package": "benchora",
                    "file": "src/lib.rs",
                    "replacement": "()",
                    "genre": "FnValue",
                }},
                "summary": "MissedMutant",
            },
            {
                "scenario": { "Mutant": {
                    "name": "src/lib.rs:3:1: replace baz with ()",
                    "package": "benchora",
                    "file": "src/lib.rs",
                    "replacement": "()",
                    "genre": "FnValue",
                }},
                "summary": "Unviable",
            },
            {
                "scenario": { "Mutant": {
                    "name": "src/lib.rs:4:1: replace qux with ()",
                    "package": "benchora",
                    "file": "src/lib.rs",
                    "replacement": "()",
                    "genre": "FnValue",
                }},
                "summary": "Timeout",
            },
        ]);
        write_outcomes_json(tmp.path(), outcomes);
        let s = parse_mutants_dir(tmp.path()).expect("parse");
        assert_eq!(s.killed, 1);
        assert_eq!(s.survived, 1);
        assert_eq!(s.unviable, 1);
        assert_eq!(s.timeout, 1);
        assert_eq!(s.total, 4);
    }

    #[test]
    fn parses_flat_outcomes_json_fallback() {
        let tmp = tempdir().unwrap();
        let outcomes = serde_json::json!([
            { "scenario": "Baseline", "summary": "Success" },
            { "scenario": { "Mutant": { "name": "x", "package": "p", "file": "f", "replacement": "r", "genre": "FnValue" }}, "summary": "CaughtMutant" },
            { "scenario": { "Mutant": { "name": "y", "package": "p", "file": "f", "replacement": "r", "genre": "FnValue" }}, "summary": "CaughtMutant" },
        ]);
        write_flat_outcomes_json(tmp.path(), outcomes);
        let s = parse_mutants_dir(tmp.path()).expect("parse");
        assert_eq!(s.killed, 2);
        assert_eq!(s.total, 2);
    }

    #[test]
    fn parses_legacy_summary_json_fallback() {
        let tmp = tempdir().unwrap();
        write_legacy_summary(
            tmp.path(),
            serde_json::json!({
                "killed": 7,
                "survived": 2,
                "timeout": 1,
                "unviable": 0,
                "no_test": 0,
            }),
        );
        let s = parse_mutants_dir(tmp.path()).expect("parse");
        assert_eq!(s.total, 10);
        assert_eq!(s.killed, 7);
        assert_eq!(s.survived, 2);
        assert_eq!(s.timeout, 1);
    }

    #[test]
    fn parses_fallback_mutations_dir() {
        let tmp = tempdir().unwrap();
        let sub = tmp.path().join("mutations");
        fs::create_dir_all(&sub).unwrap();
        let statuses = [
            "killed", "killed", "survived", "timeout", "unviable", "no_test",
        ];
        for (i, s) in statuses.iter().enumerate() {
            let body = serde_json::json!({ "status": s, "id": format!("m{i}") });
            fs::write(
                sub.join(format!("m{i}.json")),
                serde_json::to_vec(&body).unwrap(),
            )
            .unwrap();
        }
        let s = parse_mutants_dir(tmp.path()).expect("parse");
        assert_eq!(s.total, 6);
        assert_eq!(s.killed, 2);
        assert_eq!(s.survived, 1);
    }

    #[test]
    fn error_when_output_dir_empty() {
        let tmp = tempdir().unwrap();
        let err = parse_mutants_dir(tmp.path()).unwrap_err();
        match err {
            CliError::Other(_) => {}
            other => panic!("expected CliError::Other, got {other:?}"),
        }
    }
}
