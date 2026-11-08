import re
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).parents[1]


def test_status_docs_separate_structural_green_from_operational_red() -> None:
    readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
    requirements = (REPOSITORY_ROOT / "FUNCTIONAL_REQUIREMENTS.md").read_text(
        encoding="utf-8"
    )
    requirement_rows = re.findall(r"^\| \[(?P<checked>[ x])] (?P<state>GREEN|RED) \| HB-FR-", requirements, re.MULTILINE)
    operational_reds = re.findall(r"^- \[ ] RED \(operational", requirements, re.MULTILINE)

    assert requirement_rows == [("x", "GREEN")] * 96
    assert len(operational_reds) == 3
    assert "96/96 structurally satisfied" in readme
    assert "draft PR #180" in readme
    assert "../../pull/180" in readme
    assert "pull/177" not in readme
    assert "Open proper red\n\n- None" not in requirements
    assert "main-push provenance execution" in requirements
    assert "Automatic Analysis conflict" in requirements
    assert "Security Rating C" in requirements
