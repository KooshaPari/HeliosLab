"""Tests for the Tier-2 #2 Benchora-compatible heliosBench emitter."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from helios_bench.reporting.benchora_emitter import (
    HeliosBenchRow,
    _main,
    build_report,
    write_report,
)


def _cli_env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = "src"
    return env


def test_build_report_minimal() -> None:
    rows = [HeliosBenchRow(task_id="noop", wall_time_ns=1234.5)]
    report = build_report(rows)
    assert "finished_at" in report
    assert "results" in report
    assert "run_label" not in report
    assert "metadata" not in report
    assert report["results"][0]["task_id"] == "noop"
    assert report["results"][0]["wall_time_ns"] == 1234.5


def test_build_report_with_run_label() -> None:
    rows = [HeliosBenchRow(task_id="noop", wall_time_ns=1234.5)]
    report = build_report(rows, run_label="ci-nightly")
    assert report["run_label"] == "ci-nightly"


def test_build_report_with_metadata() -> None:
    rows = [HeliosBenchRow(task_id="noop", wall_time_ns=1234.5)]
    report = build_report(rows, metadata={"commit": "abc1234"})
    assert report["metadata"] == {"commit": "abc1234"}


def test_build_report_includes_trials_when_gt_one() -> None:
    rows = [HeliosBenchRow(task_id="noop", wall_time_ns=1.0, trials=5)]
    report = build_report(rows)
    assert report["results"][0]["trials"] == 5


def test_build_report_omits_trials_when_one() -> None:
    rows = [HeliosBenchRow(task_id="noop", wall_time_ns=1.0)]
    report = build_report(rows)
    assert "trials" not in report["results"][0]


def test_build_report_rejects_empty_rows() -> None:
    with pytest.raises(ValueError, match="at least one"):
        build_report([])


@pytest.mark.parametrize("wall_time", [-1, float("inf"), float("nan"), True, "1"])
def test_row_rejects_invalid_wall_time(wall_time: object) -> None:
    with pytest.raises(ValueError, match="wall_time_ns"):
        HeliosBenchRow(task_id="noop", wall_time_ns=wall_time)  # type: ignore[arg-type]


@pytest.mark.parametrize("trials", [0, -1, 1.5, True, "2"])
def test_row_rejects_invalid_trials(trials: object) -> None:
    with pytest.raises(ValueError, match="trials"):
        HeliosBenchRow(task_id="noop", wall_time_ns=1, trials=trials)  # type: ignore[arg-type]


def test_row_rejects_empty_task_and_non_object_metadata() -> None:
    with pytest.raises(ValueError, match="task_id"):
        HeliosBenchRow(task_id=" ", wall_time_ns=1)
    with pytest.raises(ValueError, match="metadata"):
        HeliosBenchRow(task_id="noop", wall_time_ns=1, metadata=[])  # type: ignore[arg-type]


def test_write_report_round_trip(tmp_path: Path) -> None:
    rows = [
        HeliosBenchRow(task_id="noop", wall_time_ns=1234.5, trials=5),
        HeliosBenchRow(task_id="parse_min", wall_time_ns=5678.0),
    ]
    out = tmp_path / "benchora-current.json"
    write_report(rows, path=out, run_label="ci-nightly", metadata={"commit": "x"})
    loaded = json.loads(out.read_text(encoding="utf-8"))
    assert loaded["run_label"] == "ci-nightly"
    assert len(loaded["results"]) == 2
    assert loaded["results"][1]["wall_time_ns"] == 5678.0


def test_cli_smoke(tmp_path: Path) -> None:
    """Smoke test: feed rows on stdin, write to --out, re-parse the file."""
    rows = [{"task_id": "noop", "wall_time_ns": 1.0}]
    out = tmp_path / "report.json"
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "helios_bench.reporting.benchora_emitter",
            "--out",
            str(out),
            "--run-label",
            "ci-nightly",
        ],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
        env=_cli_env(),
    )
    assert proc.returncode == 0, proc.stderr
    loaded = json.loads(out.read_text(encoding="utf-8"))
    assert loaded["run_label"] == "ci-nightly"
    assert loaded["results"][0]["task_id"] == "noop"


def test_cli_rejects_non_array_stdin(tmp_path: Path) -> None:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "helios_bench.reporting.benchora_emitter",
            "--out",
            str(tmp_path / "should_not_exist.json"),
        ],
        input='{"not": "an array"}',
        capture_output=True,
        text=True,
        env=_cli_env(),
    )
    assert proc.returncode == 2
    assert "must be a JSON array" in proc.stderr


def test_cli_rejects_empty_stdin(tmp_path: Path) -> None:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "helios_bench.reporting.benchora_emitter",
            "--out",
            str(tmp_path / "should_not_exist.json"),
        ],
        input="",
        capture_output=True,
        text=True,
        env=_cli_env(),
    )
    assert proc.returncode == 2
    assert "empty" in proc.stderr


def test_cli_rejects_missing_field(tmp_path: Path) -> None:
    rows = [{"task_id": "noop"}]  # missing wall_time_ns
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "helios_bench.reporting.benchora_emitter",
            "--out",
            str(tmp_path / "should_not_exist.json"),
        ],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
        env=_cli_env(),
    )
    assert proc.returncode == 2
    assert "wall_time_ns" in proc.stderr


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        ([], "at least one row"),
        ([{"task_id": "noop", "wall_time_ns": -1}], "wall_time_ns"),
        ([{"task_id": "noop", "wall_time_ns": 1, "trials": 1.5}], "trials"),
        ([{"task_id": "noop", "wall_time_ns": 1, "metadata": []}], "metadata"),
    ],
)
def test_cli_rejects_schema_invalid_rows(tmp_path: Path, rows: list[dict], message: str) -> None:
    out = tmp_path / "should_not_exist.json"
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "helios_bench.reporting.benchora_emitter",
            "--out",
            str(out),
        ],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
        env=_cli_env(),
    )
    assert proc.returncode == 2
    assert message in proc.stderr
    assert not out.exists()


def test_cli_library_path_writes_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    out = tmp_path / "report.json"
    monkeypatch.setattr(
        sys,
        "stdin",
        __import__("io").StringIO('[{"task_id":"noop","wall_time_ns":1}]'),
    )

    assert _main([
        "--out", str(out), "--run-label", "local",
        "--metadata-json", '{"commit":"abc"}',
    ]) == 0
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["metadata"] == {"commit": "abc"}


@pytest.mark.parametrize(
    ("metadata", "message"),
    [("{", "not valid JSON"), ("[]", "must decode to an object")],
)
def test_cli_library_path_rejects_invalid_report_metadata(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    metadata: str,
    message: str,
) -> None:
    monkeypatch.setattr(
        sys,
        "stdin",
        __import__("io").StringIO('[{"task_id":"noop","wall_time_ns":1}]'),
    )
    assert _main([
        "--out", str(tmp_path / "no.json"), "--metadata-json", metadata,
    ]) == 2
    assert message in capsys.readouterr().err
