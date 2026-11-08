//! Criterion report bridge.
//!
//! Reads a Criterion-format JSON report and builds a `name -> ns` index
//! suitable for diffing against a baseline. Criterion's "bencher" JSON uses
//! `full_id` (e.g. `my_benchmark::noop`) as the canonical identifier and
//! `typical` (or `median`) as the central estimate in nanoseconds.

use std::collections::BTreeMap;

/// Pull `benchmarks[]` out of a report and build a `name -> ns` map.
///
/// Criterion's "bencher" JSON uses `full_id` (e.g. `my_benchmark::noop`)
/// as the canonical identifier and `typical` (or `median`) as the
/// central estimate in nanoseconds. We try `typical` first, fall back
/// to `median`, then to `mean`.
pub(crate) fn index_benchmarks(report: &serde_json::Value) -> BTreeMap<String, f64> {
    let mut out = BTreeMap::new();
    let arr = match report.get("benchmarks").and_then(|b| b.as_array()) {
        Some(a) => a,
        None => return out,
    };
    for entry in arr {
        let name = entry
            .get("full_id")
            .and_then(|v| v.as_str())
            .or_else(|| entry.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string());
        let ns = entry
            .get("typical")
            .and_then(|v| v.get("point_estimate").and_then(|p| p.as_f64()))
            .or_else(|| {
                entry
                    .get("median")
                    .and_then(|v| v.get("point_estimate").and_then(|p| p.as_f64()))
            })
            .or_else(|| {
                entry
                    .get("mean")
                    .and_then(|v| v.get("point_estimate").and_then(|p| p.as_f64()))
            });
        if let (Some(name), Some(ns)) = (name, ns) {
            out.insert(name, ns);
        }
    }
    out
}
