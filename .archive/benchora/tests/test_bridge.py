"""Smoke tests for the helios_bench -> portage adapter bridge.

Run via:
    python -m pytest tests/test_bridge.py -v
or:
    PYTHONPATH=src python tests/test_bridge.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from helios_bench.adapters.helios_bench_to_portage import convert

REPO_ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = (
    REPO_ROOT / "src" / "helios_bench" / "adapters" / "helios_bench_to_portage.py"
)


class BridgeSmokeTests(unittest.TestCase):
    """Bridge CLI surface + structural validity of converted tasks."""

    def test_bridge_help_exits_zero(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ADAPTER_PATH), "--help"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"--help failed:\nstdout={result.stdout}\nstderr={result.stderr}",
        )
        self.assertIn("--helios-bench-root", result.stdout)
        self.assertIn("--portage-datasets", result.stdout)
        self.assertIn("--limit", result.stdout)
        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--summary-json", result.stdout)

    def test_bridge_help_avoids_conversion_imports(self) -> None:
        result = subprocess.run(
            [sys.executable, "-X", "importtime", str(ADAPTER_PATH), "--help"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        imported_modules = {
            line.rsplit("|", 1)[-1].strip()
            for line in result.stderr.splitlines()
            if line.startswith("import time:") and "|" in line
        }
        conversion_imports = {
            "argparse",
            "dataclasses",
            "json",
            "pathlib",
            "textwrap",
            "typing",
        }
        self.assertEqual(imported_modules & conversion_imports, set())

    def test_bridge_dry_run_emits_summary(self) -> None:
        """Dry-run against the live heliosBench checkout should write a JSON summary."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            datasets = tmp_path / "datasets"
            summary = tmp_path / "summary.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ADAPTER_PATH),
                    "--helios-bench-root",
                    str(REPO_ROOT),
                    "--portage-datasets",
                    str(datasets),
                    "--limit",
                    "2",
                    "--dry-run",
                    "--summary-json",
                    str(summary),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(
                result.returncode,
                0,
                f"bridge dry-run failed:\nstdout={result.stdout}\nstderr={result.stderr}",
            )
            self.assertTrue(summary.exists(), "summary JSON not written")
            data = json.loads(summary.read_text(encoding="utf-8"))
            self.assertIsInstance(data, list)
            self.assertEqual(len(data), 2)
            for entry in data:
                for field in (
                    "name",
                    "language",
                    "category",
                    "difficulty",
                    "prompt",
                    "output",
                ):
                    self.assertIn(field, entry)
            # Datasets directory exists (the adapter ensures the parent),
            # but it must be empty because --dry-run skips per-task writes.
            self.assertTrue(datasets.exists())
            self.assertEqual(
                list(datasets.iterdir()),
                [],
                "dry-run should not create per-task directories",
            )

    def test_bridge_uses_task_specific_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            datasets = Path(tmp) / "datasets"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ADAPTER_PATH),
                    "--helios-bench-root",
                    str(REPO_ROOT),
                    "--portage-datasets",
                    str(datasets),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            task_toml = (
                datasets / "helios_bench__bayesian_sampler" / "task.toml"
            ).read_text(encoding="utf-8")
            self.assertIn("timeout_sec = 45", task_toml)

    def test_convert_library_emits_complete_task_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            datasets = Path(tmp) / "datasets"
            tasks = convert(REPO_ROOT, datasets, limit=3)

            self.assertEqual(len(tasks), 3)
            task = tasks[0]
            self.assertEqual(task.timeout, 20)
            self.assertEqual(task.to_json()["timeout"], 20)
            task_dir = Path(task.output)
            self.assertTrue((task_dir / "task.toml").exists())
            self.assertTrue((task_dir / "instruction.md").exists())
            self.assertTrue((task_dir / "solution" / "solve.py").exists())
            self.assertTrue((task_dir / "tests" / "test_solution.py").exists())


if __name__ == "__main__":
    unittest.main()
