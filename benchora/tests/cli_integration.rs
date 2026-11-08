use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn cli_help_shows_subcommands() {
    Command::cargo_bin("benchora")
        .unwrap()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("run"))
        .stdout(predicate::str::contains("compare"))
        .stdout(predicate::str::contains("report"))
        .stdout(predicate::str::contains("baseline"))
        .stdout(predicate::str::contains("mutate"))
        .stdout(predicate::str::contains("list"));
}

#[test]
fn cli_version_shows_version() {
    Command::cargo_bin("benchora")
        .unwrap()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("benchora"));
}

#[test]
fn cli_run_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["run", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_compare_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["compare", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_baseline_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["baseline", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_report_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["report", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_mutate_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["mutate", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_list_help() {
    Command::cargo_bin("benchora")
        .unwrap()
        .args(["list", "--help"])
        .assert()
        .success();
}

#[test]
fn cli_invalid_subcommand_fails() {
    Command::cargo_bin("benchora")
        .unwrap()
        .arg("nonexistent")
        .assert()
        .failure();
}

#[test]
fn cli_list_baselines_default() {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("test.db");

    Command::cargo_bin("benchora")
        .unwrap()
        .args(["--db"])
        .arg(&db)
        .args(["list", "baselines"])
        .assert()
        .success();
}

#[test]
fn cli_list_reports() {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("test.db");

    Command::cargo_bin("benchora")
        .unwrap()
        .args(["--db"])
        .arg(&db)
        .args(["list", "reports"])
        .assert()
        .success();
}
