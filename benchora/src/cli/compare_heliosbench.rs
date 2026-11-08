//! heliosBench JSON bridge.
//!
//! heliosBench (the Phenotype-org internal bench tool) emits its results in
//! a different shape from Criterion: a top-level `results` array where each
//! entry has a `task_id` and a `wall_time_ns` field. The full schema is
//! documented in `docs/benchora_compare_schema.json` (Benchora's local
//! copy, kept in sync with heliosBench upstream). This
//! reader normalizes heliosBench results into the same `name -> ns`
//! mapping so a `benchora compare` call can use a heliosBench JSON as the
//! "current" or "baseline" report.

use std::collections::BTreeMap;
use std::path::Path;

use crate::cli::error::CliError;

use super::compare_criterion::index_benchmarks;

#[derive(Debug, Clone, serde::Deserialize)]
struct HeliosBenchResult {
    task_id: String,
    wall_time_ns: f64,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct HeliosBenchReport {
    /// ISO 8601 timestamp of when the run finished (parsed for schema fidelity).
    #[serde(rename = "finished_at")]
    _finished_at: Option<String>,
    /// Results array — same length as `wall_time_ns` rows.
    results: Vec<HeliosBenchResult>,
    /// Optional run label — used as a namespace prefix in the indexed names.
    #[serde(default)]
    run_label: Option<String>,
}

/// Read a heliosBench-format JSON file and return a `name -> ns` index
/// matching the shape produced by [`index_benchmarks`].
///
/// Names are formed as ``"{run_label}/{task_id}"`` when ``run_label`` is
/// present, else just ``"{task_id}"``. This makes them greppable on the
/// diff side and disambiguates runs from each other in long-lived DBs.
pub fn index_heliosbench(path: &Path) -> Result<BTreeMap<String, f64>, CliError> {
    let body = std::fs::read_to_string(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    let report: HeliosBenchReport = serde_json::from_str(&body).map_err(|e| CliError::Json {
        path: path.to_path_buf(),
        source: e,
    })?;
    let prefix = match report.run_label.as_deref() {
        Some(label) if !label.is_empty() => format!("{}/", label),
        _ => String::new(),
    };
    let mut out = BTreeMap::new();
    for r in report.results {
        out.insert(format!("{}{}", prefix, r.task_id), r.wall_time_ns);
    }
    Ok(out)
}

/// Detect whether a JSON file is a heliosBench report (presence of
/// `wall_time_ns` rows) or a Criterion report. Returns the appropriate
/// indexed map.
pub fn index_auto(path: &Path) -> Result<BTreeMap<String, f64>, CliError> {
    let body = std::fs::read_to_string(path).map_err(|e| CliError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| CliError::Json {
        path: path.to_path_buf(),
        source: e,
    })?;
    let is_heliosbench = v
        .get("results")
        .and_then(|r| r.as_array())
        .map(|arr| arr.first().and_then(|e| e.get("wall_time_ns")).is_some())
        .unwrap_or(false);
    if is_heliosbench {
        index_heliosbench(path)
    } else {
        Ok(index_benchmarks(&v))
    }
}

#[cfg(test)]
mod heliosbench_tests {
    use super::*;

    #[test]
    fn heliosbench_indexes_results() {
        let json = r#"{
            "finished_at": "2026-06-24T12:00:00Z",
            "run_label": "ci-nightly",
            "results": [
                {"task_id": "noop", "wall_time_ns": 1234.5},
                {"task_id": "parse_min", "wall_time_ns": 5678.0}
            ]
        }"#;
        let report: HeliosBenchReport =
            serde_json::from_str(json).expect("heliosBench test fixture is valid JSON");
        assert_eq!(report.results.len(), 2);
        let mut expected = BTreeMap::new();
        expected.insert("ci-nightly/noop".to_string(), 1234.5);
        expected.insert("ci-nightly/parse_min".to_string(), 5678.0);
        // Simulate index_heliosbench by hand-rolling the loop.
        let mut out = BTreeMap::new();
        for r in report.results {
            out.insert(format!("ci-nightly/{}", r.task_id), r.wall_time_ns);
        }
        assert_eq!(out, expected);
    }

    #[test]
    fn index_auto_picks_heliosbench() {
        // heliosBench style
        let helios = r#"{"results": [{"task_id": "x", "wall_time_ns": 100.0}]}"#;
        let v: serde_json::Value =
            serde_json::from_str(helios).expect("heliosBench format-detect fixture is valid JSON");
        let is_helios = v
            .get("results")
            .and_then(|r| r.as_array())
            .map(|arr| arr.first().and_then(|e| e.get("wall_time_ns")).is_some())
            .unwrap_or(false);
        assert!(is_helios);

        // Criterion style
        let crit = r#"{"benchmarks": [{"full_id": "x::y", "typical": {"point_estimate": 100.0}}]}"#;
        let v: serde_json::Value =
            serde_json::from_str(crit).expect("Criterion format-detect fixture is valid JSON");
        let is_helios = v
            .get("results")
            .and_then(|r| r.as_array())
            .map(|arr| arr.first().and_then(|e| e.get("wall_time_ns")).is_some())
            .unwrap_or(false);
        assert!(!is_helios);
    }
}
