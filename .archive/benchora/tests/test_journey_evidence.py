import json
from pathlib import Path

import yaml

JOURNEY_ROOT = Path("docs/journeys")
MANIFEST_ROOT = JOURNEY_ROOT / "manifests" / "heliosbench-main"
JOURNEY_WORKFLOW = Path(".github/workflows/journey-gate.yml")


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_main_flow_has_real_verified_evidence():
    source = _load_json(MANIFEST_ROOT / "manifest.json")
    verified = _load_json(MANIFEST_ROOT / "manifest.verified.json")

    assert source["passed"] is False, "only the verifier may mark source evidence passed"
    assert verified["passed"] is True
    assert verified["verification"]["all_intents_passed"] is True
    assert verified["verification"]["assertion_violations"] == []
    assert "HB-FR-009" in verified["traces_to"]

    assert (JOURNEY_ROOT / "recordings" / "heliosbench-main.mp4").is_file()
    assert (JOURNEY_ROOT / "recordings" / "heliosbench-main.gif").is_file()
    for step in verified["steps"]:
        frame = JOURNEY_ROOT / "keyframes" / verified["id"] / step["screenshot_path"]
        assert frame.is_file() and frame.stat().st_size > 0
        assert step["assertions"]["must_contain"]

    success_assertions = verified["steps"][-1]["assertions"]["must_contain"]
    assert {"Palindrome Check", "Fibonacci Sequence", "EXIT_0"} <= set(success_assertions)

    workflow = yaml.safe_load(JOURNEY_WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["journey-gate"]["steps"]
    install_steps = [step for step in steps if step.get("name") == "Install OCR runtime"]

    assert len(install_steps) == 1
    assert install_steps[0].get("run") == (
        "sudo apt-get update\n"
        "sudo apt-get install -y --no-install-recommends tesseract-ocr\n"
        "tesseract --version\n"
    )
