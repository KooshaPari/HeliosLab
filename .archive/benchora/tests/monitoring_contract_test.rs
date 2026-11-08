//! Soft contract for L29 Monitoring (`BENCH-005`).
//!
//! Documents and locks: CLI exit codes (0 / 1) + `benchora.report.v1`
//! envelope shape. Soft evidence only — no Prometheus org stack / secrets.

use assert_cmd::Command;
use phenotype_xdd_lib::cli::report::{REPORT_SCHEMA_V1, REPORT_V1_REQUIRED_KEYS};

/// @trace BENCH-005
#[test]
fn report_schema_v1_id_is_stable() {
    assert_eq!(
        REPORT_SCHEMA_V1, "benchora.report.v1",
        "SPEC/SSOT report schema id must stay benchora.report.v1"
    );
}

/// @trace BENCH-005
#[test]
fn report_v1_envelope_lists_required_keys() {
    // Mirror the envelope `report::run_suite` writes so auditors/agents can
    // validate JSON without a live cargo-bench run.
    let sample = serde_json::json!({
        "schema": REPORT_SCHEMA_V1,
        "suite": "core",
        "created_at": "2026-07-23T00:00:00Z",
        "bench_name": "my_benchmark",
        "benchmarks": [],
        "host": { "target": "x86_64-pc-windows-msvc", "cpus": 8 },
        "note": null,
    });
    let obj = sample.as_object().expect("envelope object");
    for key in REPORT_V1_REQUIRED_KEYS {
        assert!(
            obj.contains_key(*key),
            "benchora.report.v1 must include `{key}`; keys={:?}",
            obj.keys().collect::<Vec<_>>()
        );
    }
    assert_eq!(
        obj.get("schema").and_then(|v| v.as_str()),
        Some(REPORT_SCHEMA_V1)
    );
    assert!(obj.get("benchmarks").and_then(|v| v.as_array()).is_some());
}

/// @trace BENCH-005
#[test]
fn cli_help_exits_zero() {
    Command::cargo_bin("benchora")
        .expect("benchora bin")
        .arg("--help")
        .assert()
        .success()
        .code(0);
}

/// @trace BENCH-005
#[test]
fn cli_unknown_subcommand_exits_nonzero() {
    // Clap rejects unknown subcommands before `cli::run`; process still exits 2
    // (clap) or 1 — either is a non-zero monitoring signal for CI.
    let assert = Command::cargo_bin("benchora")
        .expect("benchora bin")
        .arg("not-a-real-subcommand")
        .assert()
        .failure();
    let code = assert.get_output().status.code();
    assert!(
        matches!(code, Some(1) | Some(2)),
        "expected non-zero exit (1 CliError path or 2 clap usage); got {code:?}"
    );
}

/// @trace BENCH-005
#[test]
fn cli_report_missing_file_exits_one() {
    // Dispatcher path: CliError::Io → bin exits 1 (primary health signal).
    Command::cargo_bin("benchora")
        .expect("benchora bin")
        .args([
            "report",
            "target/benchora-tests/definitely-missing-report.json",
        ])
        .assert()
        .failure()
        .code(1);
}
