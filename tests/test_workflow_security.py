import re
import tomllib
from pathlib import Path

import yaml

WORKFLOW_DIR = Path(__file__).parents[1] / ".github" / "workflows"
USES_PATTERN = re.compile(r"^\s*-?\s*uses:\s*([^#\s]+)")
PINNED_ACTION_PATTERN = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
PINNED_REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def test_external_workflow_actions_are_pinned_to_commits() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        for line_number, line in enumerate(workflow.read_text(encoding="utf-8").splitlines(), 1):
            match = USES_PATTERN.match(line)
            if match is None:
                continue

            action = match.group(1)
            if action.startswith("./") or PINNED_ACTION_PATTERN.fullmatch(action):
                continue
            violations.append(f"{workflow.name}:{line_number}: {action}")

    assert violations == [], "mutable workflow action references:\n" + "\n".join(violations)


def test_external_pre_commit_hooks_are_pinned_to_commits() -> None:
    config_path = WORKFLOW_DIR.parents[1] / ".pre-commit-config.yaml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    violations: list[str] = []

    for hook_repository in document.get("repos", []):
        repository = hook_repository.get("repo")
        if repository in {"local", "meta"}:
            continue
        revision = hook_repository.get("rev")
        if not isinstance(revision, str) or PINNED_REVISION_PATTERN.fullmatch(revision) is None:
            violations.append(f"{repository}: {revision!r}")

    assert violations == [], "mutable pre-commit hook revisions:\n" + "\n".join(violations)


def test_pre_commit_runner_is_exactly_pinned_in_the_frozen_environment() -> None:
    repository_root = WORKFLOW_DIR.parents[1]
    project = tomllib.loads((repository_root / "pyproject.toml").read_text(encoding="utf-8"))
    lock = tomllib.loads((repository_root / "uv.lock").read_text(encoding="utf-8"))
    dev_dependencies = project["project"]["optional-dependencies"]["dev"]
    runner_specs = [spec for spec in dev_dependencies if spec.startswith("pre-commit")]
    violations: list[str] = []

    if len(runner_specs) != 1 or re.fullmatch(
        r"pre-commit==[0-9]+\.[0-9]+\.[0-9]+", runner_specs[0] if runner_specs else ""
    ) is None:
        violations.append(f"expected one exact pre-commit dev dependency, found {runner_specs!r}")
    else:
        expected_version = runner_specs[0].split("==", 1)[1]
        locked_versions = [
            package.get("version")
            for package in lock.get("package", [])
            if package.get("name") == "pre-commit"
        ]
        if locked_versions != [expected_version]:
            violations.append(
                f"pre-commit spec {expected_version!r} differs from uv.lock {locked_versions!r}"
            )

    assert violations == [], "mutable pre-commit runner environment:\n" + "\n".join(violations)


def test_required_ci_builds_distributions_with_a_frozen_backend() -> None:
    repository_root = WORKFLOW_DIR.parents[1]
    project = tomllib.loads((repository_root / "pyproject.toml").read_text(encoding="utf-8"))
    lock = tomllib.loads((repository_root / "uv.lock").read_text(encoding="utf-8"))
    dev_dependencies = project["project"]["optional-dependencies"]["dev"]
    backend_specs = [spec for spec in dev_dependencies if spec.startswith("hatchling")]
    ci = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    build_steps = [
        step
        for step in ci["jobs"]["test"]["steps"]
        if step.get("run") == "uv build --no-build-isolation --clear"
    ]
    violations: list[str] = []
    expected_sdist_inputs = {
        "/src",
        "/tests",
        "/README.md",
        "/LICENSE",
        "/pyproject.toml",
        "/uv.lock",
    }

    if len(backend_specs) != 1 or re.fullmatch(
        r"hatchling==[0-9]+\.[0-9]+\.[0-9]+", backend_specs[0] if backend_specs else ""
    ) is None:
        violations.append(f"expected one exact Hatchling dev dependency, found {backend_specs!r}")
    else:
        expected_version = backend_specs[0].split("==", 1)[1]
        locked_versions = [
            package.get("version")
            for package in lock.get("package", [])
            if package.get("name") == "hatchling"
        ]
        if locked_versions != [expected_version]:
            violations.append(f"Hatchling spec differs from uv.lock: {locked_versions!r}")
    if len(build_steps) != 1:
        violations.append("required CI does not perform one clean, non-isolated distribution build")
    elif build_steps[0].get("continue-on-error") is not None:
        violations.append("required CI can ignore a failed distribution build")
    sdist_inputs = (
        project.get("tool", {})
        .get("hatch", {})
        .get("build", {})
        .get("targets", {})
        .get("sdist", {})
        .get("include", [])
    )
    if set(sdist_inputs) != expected_sdist_inputs:
        violations.append(f"source distribution inputs are not allowlisted: {sdist_inputs!r}")

    assert violations == [], "mutable or false-green package build:\n" + "\n".join(violations)


def test_required_ci_strictly_validates_both_distribution_formats() -> None:
    repository_root = WORKFLOW_DIR.parents[1]
    project = tomllib.loads((repository_root / "pyproject.toml").read_text(encoding="utf-8"))
    lock = tomllib.loads((repository_root / "uv.lock").read_text(encoding="utf-8"))
    dev_dependencies = project["project"]["optional-dependencies"]["dev"]
    verifier_specs = [spec for spec in dev_dependencies if spec.startswith("twine")]
    ci = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    verification_steps = [
        step
        for step in ci["jobs"]["test"]["steps"]
        if step.get("run") == "uv run twine check --strict dist/*"
    ]
    violations: list[str] = []

    if len(verifier_specs) != 1 or re.fullmatch(
        r"twine==[0-9]+\.[0-9]+\.[0-9]+", verifier_specs[0] if verifier_specs else ""
    ) is None:
        violations.append(f"expected one exact Twine dev dependency, found {verifier_specs!r}")
    else:
        expected_version = verifier_specs[0].split("==", 1)[1]
        locked_versions = [
            package.get("version")
            for package in lock.get("package", [])
            if package.get("name") == "twine"
        ]
        if locked_versions != [expected_version]:
            violations.append(f"Twine spec differs from uv.lock: {locked_versions!r}")
    if len(verification_steps) != 1:
        violations.append("required CI does not strictly validate every built distribution")
    elif verification_steps[0].get("continue-on-error") is not None:
        violations.append("required CI can ignore invalid distribution metadata")

    assert violations == [], "mutable or false-green distribution validation:\n" + "\n".join(
        violations
    )


def test_required_ci_records_and_verifies_distribution_digests() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["test"]["steps"]
    digest_steps = [step for step in steps if step.get("name") == "Verify distribution digests"]
    expected_command = (
        "cd dist\n"
        "sha256sum *.whl *.tar.gz | sort -k2 | tee SHA256SUMS\n"
        "sha256sum --check SHA256SUMS\n"
    )
    violations: list[str] = []

    if len(digest_steps) != 1:
        violations.append("required CI has no unique distribution digest step")
    else:
        step = digest_steps[0]
        if step.get("shell") != "bash":
            violations.append("distribution digest generation does not use the declared POSIX shell")
        if step.get("run") != expected_command:
            violations.append("distribution digests are not deterministically recorded and checked")
        if step.get("continue-on-error") is not None:
            violations.append("required CI can ignore a distribution digest mismatch")
        step_index = steps.index(step)
        validation_indexes = [
            index
            for index, candidate in enumerate(steps)
            if candidate.get("run") == "uv run twine check --strict dist/*"
        ]
        if validation_indexes != [step_index - 1]:
            violations.append("digest verification does not immediately follow metadata validation")

    assert violations == [], "untraceable distribution artifacts:\n" + "\n".join(violations)


def test_required_ci_retains_validated_distributions_with_their_digests() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    job = document["jobs"]["test"]
    steps = job["steps"]
    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    violations: list[str] = []

    if len(upload_steps) != 1:
        violations.append("required CI has no unique distribution artifact handoff")
    else:
        step = upload_steps[0]
        inputs = step.get("with", {})
        if step.get("uses") != "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02":
            violations.append("distribution uploader is not pinned to the audited commit")
        if inputs.get("name") != "validated-python-distributions":
            violations.append("distribution artifact has no stable identity")
        if inputs.get("path") != "dist/":
            violations.append("distribution artifact does not retain archives and SHA256SUMS together")
        if inputs.get("retention-days") != 1:
            violations.append("distribution artifact retention is not explicitly one day")
        if inputs.get("if-no-files-found") != "error":
            violations.append("missing distributions do not fail the artifact handoff")
        upload_index = steps.index(step)
        digest_indexes = [
            index
            for index, candidate in enumerate(steps)
            if candidate.get("name") == "Verify distribution digests"
        ]
        if len(digest_indexes) != 1 or digest_indexes[0] >= upload_index:
            violations.append("distribution upload occurs before digest verification")

    permissions = job.get("permissions", document.get("permissions", {}))
    if permissions.get("id-token") == "write" or permissions.get("attestations") == "write":
        violations.append("required validation CI can mint distribution attestations")

    assert violations == [], "ephemeral distribution evidence:\n" + "\n".join(violations)


def test_distribution_handoff_occurs_only_after_required_validation() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["test"]["steps"]
    upload_indexes = [
        index
        for index, step in enumerate(steps)
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    test_indexes = [
        index
        for index, step in enumerate(steps)
        if step.get("run") == "uv run pytest --cov=helios_bench --cov-report=term-missing"
    ]
    violations: list[str] = []

    if len(upload_indexes) != 1 or upload_indexes[0] != len(steps) - 1:
        violations.append("distribution handoff is not the final required CI step")
    if len(test_indexes) != 1:
        violations.append("required CI has no unique test and coverage gate")
    elif len(upload_indexes) == 1 and test_indexes[0] != upload_indexes[0] - 1:
        violations.append("distribution handoff does not immediately follow the test and coverage gate")

    assert violations == [], "premature distribution handoff:\n" + "\n".join(violations)


def test_distribution_provenance_consumes_only_trusted_main_artifacts() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    job = document["jobs"].get("provenance")
    violations: list[str] = []

    if job is None:
        violations.append("required CI has no distribution provenance consumer")
    else:
        if job.get("needs") != "test":
            violations.append("distribution provenance does not require successful validation")
        expected_guard = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
        if job.get("if") != expected_guard:
            violations.append("distribution provenance is not restricted to main-branch pushes")
        if job.get("permissions") != {
            "contents": "read",
            "attestations": "write",
            "id-token": "write",
        }:
            violations.append("distribution provenance permissions are not minimal")

        steps = job.get("steps", [])
        download_steps = [
            step for step in steps if step.get("uses", "").startswith("actions/download-artifact@")
        ]
        if len(download_steps) != 1:
            violations.append("distribution provenance has no unique artifact consumer")
        else:
            download = download_steps[0]
            if (
                download.get("uses")
                != "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093"
            ):
                violations.append("distribution artifact consumer is not pinned")
            if download.get("with") != {
                "artifact-ids": "${{ needs.test.outputs.validated-distributions-id }}",
                "path": "dist",
            }:
                violations.append("provenance does not consume the validated distribution handoff")

        verify_steps = [
            step for step in steps if step.get("name") == "Reverify distribution digests"
        ]
        if len(verify_steps) != 1:
            violations.append("downloaded distributions are not reverified before attestation")

        attest_steps = [
            step
            for step in steps
            if step.get("uses", "").startswith("actions/attest-build-provenance@")
        ]
        if len(attest_steps) != 1:
            violations.append("distribution provenance has no unique attestation")
        elif attest_steps[0].get("with") != {"subject-checksums": "dist/SHA256SUMS"}:
            violations.append("distribution attestation does not cover the complete handoff")

        if len(verify_steps) == 1 and len(attest_steps) == 1:
            if steps.index(attest_steps[0]) != steps.index(verify_steps[0]) + 1:
                violations.append("distribution attestation does not immediately follow reverification")

    assert violations == [], "untrusted distribution provenance:\n" + "\n".join(violations)


def test_distribution_provenance_rejects_unmanifested_archives() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    verify_steps = [step for step in steps if step.get("name") == "Reverify distribution digests"]
    if len(verify_steps) != 1:
        violations.append("distribution provenance has no unique digest reverification step")
    else:
        command = verify_steps[0].get("run", "")
        required_fragments = (
            "find . -maxdepth 1 -type f",
            "-name '*.whl'",
            "-name '*.tar.gz'",
            "awk '{print $2}' SHA256SUMS",
            "diff -u",
            "sha256sum --check --strict SHA256SUMS",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"distribution manifest coverage omits: {fragment}")

    attest_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/attest-build-provenance@")
    ]
    if len(attest_steps) != 1:
        violations.append("distribution provenance has no unique attestation")
    else:
        if attest_steps[0].get("with") != {"subject-checksums": "dist/SHA256SUMS"}:
            violations.append("provenance attestation is not bounded to the verified manifest")

    assert violations == [], "incomplete distribution provenance coverage:\n" + "\n".join(violations)


def test_distribution_provenance_consumes_the_exact_producer_artifact() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    test_job = document["jobs"]["test"]
    provenance_job = document["jobs"]["provenance"]
    violations: list[str] = []

    upload_steps = [
        step
        for step in test_job.get("steps", [])
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    if len(upload_steps) != 1:
        violations.append("required CI has no unique validated distribution producer")
    else:
        upload_id = upload_steps[0].get("id")
        if upload_id != "validated-distributions":
            violations.append("validated distribution producer has no stable step identity")
        expected_output = "${{ steps.validated-distributions.outputs.artifact-id }}"
        if test_job.get("outputs", {}).get("validated-distributions-id") != expected_output:
            violations.append("required CI does not expose the exact validated artifact ID")

    download_steps = [
        step
        for step in provenance_job.get("steps", [])
        if step.get("uses", "").startswith("actions/download-artifact@")
    ]
    if len(download_steps) != 1:
        violations.append("provenance has no unique validated distribution consumer")
    else:
        expected_inputs = {
            "artifact-ids": "${{ needs.test.outputs.validated-distributions-id }}",
            "path": "dist",
        }
        if download_steps[0].get("with") != expected_inputs:
            violations.append("provenance selects its distribution handoff by name, not producer ID")

    assert violations == [], "unbound distribution producer identity:\n" + "\n".join(violations)


def test_distribution_provenance_rejects_an_empty_artifact_identity() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    download_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/download-artifact@")
    ]
    identity_steps = [step for step in steps if step.get("name") == "Validate artifact identity"]
    if len(download_steps) != 1:
        violations.append("provenance has no unique artifact download")
    elif len(identity_steps) != 1:
        violations.append("provenance does not fail closed on an empty artifact ID")
    else:
        identity_step = identity_steps[0]
        if steps.index(identity_step) + 1 != steps.index(download_steps[0]):
            violations.append("artifact identity is not validated immediately before download")
        if identity_step.get("shell") != "bash":
            violations.append("artifact identity validation does not use an explicit shell")
        if identity_step.get("env") != {
            "VALIDATED_DISTRIBUTIONS_ID": "${{ needs.test.outputs.validated-distributions-id }}"
        }:
            violations.append("artifact identity validation is not bound to the producer output")
        command = identity_step.get("run", "")
        if '[[ "$VALIDATED_DISTRIBUTIONS_ID" =~ ^[1-9][0-9]*$ ]]' not in command:
            violations.append("artifact identity validation accepts an empty or malformed ID")

    assert violations == [], "unsafe empty artifact identity fallback:\n" + "\n".join(violations)


def test_distribution_provenance_requires_both_distribution_formats() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    verify_steps = [step for step in steps if step.get("name") == "Reverify distribution digests"]
    if len(verify_steps) != 1:
        violations.append("provenance has no unique distribution verification step")
    else:
        command = verify_steps[0].get("run", "")
        expected_counts = (
            'test "$(find . -maxdepth 1 -type f -name \'*.whl\' | wc -l)" -eq 1',
            'test "$(find . -maxdepth 1 -type f -name \'*.tar.gz\' | wc -l)" -eq 1',
        )
        for expected_count in expected_counts:
            if expected_count not in command:
                violations.append(f"distribution set is not fail-closed: {expected_count}")

    assert violations == [], "incomplete distribution format set:\n" + "\n".join(violations)


def test_distribution_provenance_attests_the_verified_checksum_manifest() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    verify_steps = [step for step in steps if step.get("name") == "Reverify distribution digests"]
    attest_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/attest-build-provenance@")
    ]
    if len(verify_steps) != 1 or len(attest_steps) != 1:
        violations.append("provenance lacks unique verification and attestation boundaries")
    else:
        attest_inputs = attest_steps[0].get("with", {})
        if attest_inputs != {"subject-checksums": "dist/SHA256SUMS"}:
            violations.append("attestation recomputes glob subjects instead of consuming the manifest")
        if steps.index(attest_steps[0]) != steps.index(verify_steps[0]) + 1:
            violations.append("attestation does not immediately consume the verified manifest")

    assert violations == [], "unbound attestation subject digests:\n" + "\n".join(violations)


def test_distribution_provenance_requires_a_concrete_attestation_result() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    attest_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/attest-build-provenance@")
    ]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    if len(attest_steps) != 1:
        violations.append("provenance has no unique attestation action")
    elif attest_steps[0].get("id") != "attest-distributions":
        violations.append("attestation action has no stable output identity")
    elif len(result_steps) != 1:
        violations.append("provenance accepts an attestation without checking its result")
    else:
        result_step = result_steps[0]
        if steps.index(result_step) != steps.index(attest_steps[0]) + 1:
            violations.append("attestation result is not checked immediately")
        if result_step.get("shell") != "bash":
            violations.append("attestation result check has no explicit shell")
        if result_step.get("env") != {
            "ATTESTATION_ID": "${{ steps.attest-distributions.outputs.attestation-id }}",
            "BUNDLE_PATH": "${{ steps.attest-distributions.outputs.bundle-path }}",
            "EXPECTED_REPOSITORY": "https://github.com/${{ github.repository }}",
            "EXPECTED_REF": "refs/heads/main",
            "EXPECTED_WORKFLOW_PATH": ".github/workflows/ci.yml",
            "EXPECTED_INVOCATION": (
                "https://github.com/${{ github.repository }}/actions/runs/"
                "${{ github.run_id }}/attempts/${{ github.run_attempt }}"
            ),
            "EXPECTED_SOURCE": (
                "git+https://github.com/${{ github.repository }}@refs/heads/main"
            ),
            "EXPECTED_COMMIT": "${{ github.sha }}",
        }:
            violations.append("attestation result check is not bound to action outputs")
        command = result_step.get("run", "")
        for fragment in ('test -n "$ATTESTATION_ID"', 'test -f "$BUNDLE_PATH"'):
            if fragment not in command:
                violations.append(f"attestation result check omits: {fragment}")

    assert violations == [], "missing concrete attestation result:\n" + "\n".join(violations)


def test_distribution_provenance_validates_bundle_structure_before_retention() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    if len(result_steps) != 1 or len(upload_steps) != 1:
        violations.append("provenance lacks unique bundle validation and retention boundaries")
    else:
        result_step = result_steps[0]
        command = result_step.get("run", "")
        if 'test -s "$BUNDLE_PATH"' not in command:
            violations.append("empty attestation bundles are accepted")
        required_fields = (".mediaType", ".verificationMaterial", ".dsseEnvelope")
        if "jq -e" not in command or any(field not in command for field in required_fields):
            violations.append("bundle is not validated as a JSON Sigstore DSSE envelope")
        if steps.index(upload_steps[0]) != steps.index(result_step) + 1:
            violations.append("bundle retention does not immediately follow structural validation")

    assert violations == [], "invalid retained attestation bundle:\n" + "\n".join(violations)


def test_distribution_provenance_requires_the_sigstore_bundle_media_type() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        expected_media_type = (
            '.mediaType == "application/vnd.dev.sigstore.bundle.v0.3+json"'
        )
        if expected_media_type not in command:
            violations.append("an arbitrary prefixed bundle format can be retained")

    assert violations == [], "wrong Sigstore bundle format:\n" + "\n".join(violations)


def test_distribution_provenance_requires_nonempty_verification_material() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        if "(.verificationMaterial | length) > 0" not in command:
            violations.append("empty signer verification material can be retained")

    assert violations == [], "missing verification material:\n" + "\n".join(violations)


def test_distribution_provenance_requires_a_transparency_log_entry() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.verificationMaterial.tlogEntries | type) == "array")',
            "(.verificationMaterial.tlogEntries | length) > 0",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log validation omits: {fragment}")

    assert violations == [], "untraceable signer evidence:\n" + "\n".join(violations)


def test_distribution_provenance_requires_identified_transparency_log_entries() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            "all(.verificationMaterial.tlogEntries[];",
            '((.logId.keyId | type) == "string")',
            "((.logId.keyId | length) > 0)",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log identity validation omits: {fragment}")

    assert violations == [], "anonymous transparency-log evidence:\n" + "\n".join(violations)


def test_distribution_provenance_requires_base64_transparency_log_ids() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        base64_log_id = (
            '(.logId.keyId | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))'
        )
        if base64_log_id not in command:
            violations.append("arbitrary transparency-log key bytes can be retained")

    assert violations == [], "malformed transparency-log identity:\n" + "\n".join(violations)


def test_distribution_provenance_requires_transparency_log_entry_bodies() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.canonicalizedBody | type) == "string")',
            "((.canonicalizedBody | length) > 0)",
            '(.canonicalizedBody | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log body validation omits: {fragment}")

    assert violations == [], "missing transparency-log entry body:\n" + "\n".join(violations)


def test_distribution_provenance_requires_transparency_log_inclusion_promises() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.inclusionPromise.signedEntryTimestamp | type) == "string")',
            "((.inclusionPromise.signedEntryTimestamp | length) > 0)",
            '(.inclusionPromise.signedEntryTimestamp | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log promise validation omits: {fragment}")

    assert violations == [], "missing transparency-log inclusion promise:\n" + "\n".join(
        violations
    )


def test_distribution_provenance_requires_transparency_log_indices() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.logIndex | type) == "string")',
            '(.logIndex | test("^(0|[1-9][0-9]*)$"))',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log index validation omits: {fragment}")

    assert violations == [], "missing transparency-log index:\n" + "\n".join(violations)


def test_distribution_provenance_requires_transparency_log_integration_times() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.integratedTime | type) == "string")',
            '(.integratedTime | test("^(0|[1-9][0-9]*)$"))',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log time validation omits: {fragment}")

    assert violations == [], "missing transparency-log integration time:\n" + "\n".join(
        violations
    )


def test_distribution_provenance_requires_transparency_log_record_formats() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.kindVersion.kind | type) == "string")',
            "((.kindVersion.kind | length) > 0)",
            '((.kindVersion.version | type) == "string")',
            "((.kindVersion.version | length) > 0)",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"transparency-log format validation omits: {fragment}")

    assert violations == [], "missing transparency-log record format:\n" + "\n".join(
        violations
    )


def test_distribution_provenance_requires_a_signer_certificate_chain() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.verificationMaterial.x509CertificateChain.certificates | type) == "array")',
            "(.verificationMaterial.x509CertificateChain.certificates | length) > 0",
            "all(.verificationMaterial.x509CertificateChain.certificates[];",
            '((.rawBytes | type) == "string")',
            "((.rawBytes | length) > 0)",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"signer certificate validation omits: {fragment}")

    assert violations == [], "missing signer certificate chain:\n" + "\n".join(violations)


def test_distribution_provenance_requires_base64_signer_certificates() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        base64_certificate = (
            '(.rawBytes | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))'
        )
        if base64_certificate not in command:
            violations.append("arbitrary signer certificate bytes can be retained")

    assert violations == [], "malformed signer certificate:\n" + "\n".join(violations)


def test_distribution_provenance_requires_the_intoto_dsse_payload_type() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        expected_payload_type = (
            '.dsseEnvelope.payloadType == "application/vnd.in-toto+json"'
        )
        if expected_payload_type not in command:
            violations.append("an arbitrary DSSE payload type can be decoded as provenance")

    assert violations == [], "wrong DSSE payload type:\n" + "\n".join(violations)


def test_distribution_provenance_requires_a_base64_dsse_payload() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.dsseEnvelope.payload | type) == "string")',
            "((.dsseEnvelope.payload | length) > 0)",
            '(.dsseEnvelope.payload | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"DSSE payload validation omits: {fragment}")

    assert violations == [], "malformed DSSE payload:\n" + "\n".join(violations)


def test_distribution_provenance_requires_a_nonempty_dsse_signature() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            '((.dsseEnvelope.signatures | type) == "array")',
            "(.dsseEnvelope.signatures | length) > 0",
            "all(.dsseEnvelope.signatures[];",
            '(.sig | type) == "string"',
            "(.sig | length) > 0",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"DSSE signature validation omits: {fragment}")

    assert violations == [], "unsigned DSSE envelope:\n" + "\n".join(violations)


def test_distribution_provenance_requires_base64_dsse_signatures() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        base64_signature = (
            '(.sig | test("^([A-Za-z0-9+/]{4})*'
            '([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))'
        )
        if base64_signature not in command:
            violations.append("arbitrary DSSE signature bytes can be retained")

    assert violations == [], "malformed DSSE signature:\n" + "\n".join(violations)


def test_distribution_provenance_cryptographically_verifies_every_distribution() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            "while read -r artifact; do",
            'gh attestation verify "dist/$artifact"',
            '--repo "$GITHUB_REPOSITORY"',
            '--bundle "$BUNDLE_PATH"',
            '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/ci.yml"',
            '--source-ref "$EXPECTED_REF"',
            '--source-digest "$EXPECTED_COMMIT"',
            "--deny-self-hosted-runners",
            "done < <(awk '{print $2}' dist/SHA256SUMS | sed 's/^\\*//')",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"cryptographic verification omits: {fragment}")

    assert violations == [], "unverified provenance signature:\n" + "\n".join(violations)


def test_distribution_provenance_binds_the_signer_workflow_revision() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        if '--signer-digest "$EXPECTED_COMMIT"' not in command:
            violations.append("signer workflow revision is not bound to the release commit")

    assert violations == [], "unbound signer workflow revision:\n" + "\n".join(violations)


def test_distribution_provenance_supports_public_repository_attestations() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    attest_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/attest-build-provenance@")
    ]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(attest_steps) != 1 or len(result_steps) != 1:
        violations.append("provenance lacks unique attestation and validation boundaries")
    else:
        command = result_steps[0].get("run", "")
        if "--no-public-good" in command:
            violations.append("public-good attestations from the public repository are rejected")

    assert violations == [], "incompatible public attestation trust:\n" + "\n".join(violations)


def test_distribution_provenance_pins_the_certificate_issuer() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        expected_issuer = (
            '--cert-oidc-issuer "https://token.actions.githubusercontent.com"'
        )
        if expected_issuer not in command:
            violations.append("certificate issuer depends on the verifier's default")

    assert violations == [], "unpinned attestation certificate issuer:\n" + "\n".join(violations)


def test_distribution_provenance_pins_the_verified_predicate_type() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        expected_predicate = (
            '--predicate-type "https://slsa.dev/provenance/v1"'
        )
        if expected_predicate not in command:
            violations.append("verified predicate type depends on the verifier's default")

    assert violations == [], "unpinned verified predicate type:\n" + "\n".join(violations)


def test_distribution_provenance_pins_the_artifact_digest_algorithm() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        if '--digest-alg "sha256"' not in command:
            violations.append("artifact digest algorithm depends on the verifier's default")

    assert violations == [], "unpinned artifact digest algorithm:\n" + "\n".join(violations)


def test_distribution_provenance_binds_bundle_subjects_to_the_manifest() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    if len(result_steps) != 1 or len(upload_steps) != 1:
        violations.append("provenance lacks unique bundle validation and retention boundaries")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            ".dsseEnvelope.payload",
            "base64 --decode",
            '._type == "https://in-toto.io/Statement/v1"',
            ".subject[]",
            ".digest.sha256",
            'sort -k2 > "$RUNNER_TEMP/attestation.subjects"',
            'diff -u dist/SHA256SUMS "$RUNNER_TEMP/attestation.subjects"',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"attestation subject binding omits: {fragment}")
        if steps.index(upload_steps[0]) != steps.index(result_steps[0]) + 1:
            violations.append("bundle retention does not immediately follow subject validation")

    assert violations == [], "unbound attestation subjects:\n" + "\n".join(violations)


def test_distribution_provenance_requires_the_slsa_predicate() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        if '.predicateType == "https://slsa.dev/provenance/v1"' not in command:
            violations.append("an arbitrary in-toto predicate can pass as build provenance")

    assert violations == [], "wrong attestation predicate type:\n" + "\n".join(violations)


def test_distribution_provenance_binds_the_workflow_identity() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        result_step = result_steps[0]
        expected_context = {
            "EXPECTED_REPOSITORY": "https://github.com/${{ github.repository }}",
            "EXPECTED_REF": "refs/heads/main",
            "EXPECTED_WORKFLOW_PATH": ".github/workflows/ci.yml",
        }
        environment = result_step.get("env", {})
        for key, value in expected_context.items():
            if environment.get(key) != value:
                violations.append(f"attestation validation is not bound to {key}")

        command = result_step.get("run", "")
        required_fragments = (
            '--arg expected_repository "$EXPECTED_REPOSITORY"',
            '--arg expected_ref "$EXPECTED_REF"',
            '--arg expected_workflow_path "$EXPECTED_WORKFLOW_PATH"',
            '.predicate.buildDefinition.buildType == "https://actions.github.io/buildtypes/workflow/v1"',
            ".predicate.buildDefinition.externalParameters.workflow.repository == $expected_repository",
            ".predicate.buildDefinition.externalParameters.workflow.ref == $expected_ref",
            ".predicate.buildDefinition.externalParameters.workflow.path == $expected_workflow_path",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"workflow identity validation omits: {fragment}")

    assert violations == [], "unbound provenance workflow identity:\n" + "\n".join(violations)


def test_distribution_provenance_binds_the_builder_identity() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        expected_builder = (
            '.predicate.runDetails.builder.id '
            '== "https://github.com/actions/runner/github-hosted"'
        )
        if expected_builder not in command:
            violations.append("attestation validation accepts an untrusted builder identity")

    assert violations == [], "unbound provenance builder identity:\n" + "\n".join(violations)


def test_distribution_provenance_binds_the_invocation_identity() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        result_step = result_steps[0]
        expected_invocation = (
            "https://github.com/${{ github.repository }}/actions/runs/"
            "${{ github.run_id }}/attempts/${{ github.run_attempt }}"
        )
        if result_step.get("env", {}).get("EXPECTED_INVOCATION") != expected_invocation:
            violations.append("attestation validation is not bound to the current run attempt")

        command = result_step.get("run", "")
        required_fragments = (
            '--arg expected_invocation "$EXPECTED_INVOCATION"',
            ".predicate.runDetails.metadata.invocationId == $expected_invocation",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"invocation identity validation omits: {fragment}")

    assert violations == [], "unbound provenance invocation identity:\n" + "\n".join(violations)


def test_distribution_provenance_binds_the_source_revision() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        result_step = result_steps[0]
        expected_environment = {
            "EXPECTED_SOURCE": (
                "git+https://github.com/${{ github.repository }}@refs/heads/main"
            ),
            "EXPECTED_COMMIT": "${{ github.sha }}",
        }
        environment = result_step.get("env", {})
        for key, value in expected_environment.items():
            if environment.get(key) != value:
                violations.append(f"attestation validation is not bound to {key}")

        command = result_step.get("run", "")
        required_fragments = (
            '--arg expected_source "$EXPECTED_SOURCE"',
            '--arg expected_commit "$EXPECTED_COMMIT"',
            '((.predicate.buildDefinition.resolvedDependencies | type) == "array")',
            "any(.predicate.buildDefinition.resolvedDependencies[];",
            ".uri == $expected_source",
            ".digest.gitCommit == $expected_commit",
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"source revision validation omits: {fragment}")

    assert violations == [], "unbound provenance source revision:\n" + "\n".join(violations)


def test_distribution_provenance_has_one_unambiguous_source_claim() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    violations: list[str] = []

    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation validation boundary")
    else:
        command = result_steps[0].get("run", "")
        required_fragments = (
            "[.predicate.buildDefinition.resolvedDependencies[]",
            "select(.uri == $expected_source)",
            "] as $source_dependencies",
            "($source_dependencies | length) == 1",
            '(($source_dependencies[0].digest | keys) == ["gitCommit"])',
        )
        for fragment in required_fragments:
            if fragment not in command:
                violations.append(f"unambiguous source validation omits: {fragment}")

    assert violations == [], "ambiguous provenance source claims:\n" + "\n".join(violations)


def test_distribution_provenance_retains_the_validated_bundle() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    result_steps = [step for step in steps if step.get("name") == "Validate attestation result"]
    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    if len(result_steps) != 1:
        violations.append("provenance has no unique attestation result validation")
    elif len(upload_steps) != 1:
        violations.append("provenance does not retain one attestation bundle")
    else:
        upload = upload_steps[0]
        if steps.index(upload) != steps.index(result_steps[0]) + 1:
            violations.append("attestation bundle is retained before validation or after intervening work")
        if upload.get("uses") != "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02":
            violations.append("attestation bundle uploader is not pinned")
        if upload.get("with") != {
            "name": "validated-distribution-provenance",
            "path": "${{ steps.attest-distributions.outputs.bundle-path }}",
            "retention-days": 1,
            "if-no-files-found": "error",
            "overwrite": False,
        }:
            violations.append("attestation bundle retention is mutable or fail-open")

    assert violations == [], "unretained attestation bundle:\n" + "\n".join(violations)


def test_retained_provenance_bundle_has_an_immutable_identity() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["provenance"]["steps"]
    violations: list[str] = []

    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    identity_steps = [step for step in steps if step.get("name") == "Validate retained bundle identity"]
    if len(upload_steps) != 1:
        violations.append("provenance has no unique bundle retention action")
    elif upload_steps[0].get("id") != "retain-provenance-bundle":
        violations.append("bundle retention has no stable output identity")
    elif len(identity_steps) != 1:
        violations.append("bundle retention succeeds without checking artifact outputs")
    else:
        identity_step = identity_steps[0]
        if steps.index(identity_step) != steps.index(upload_steps[0]) + 1:
            violations.append("retained bundle identity is not checked immediately")
        if identity_step.get("shell") != "bash":
            violations.append("retained bundle identity check has no explicit shell")
        if identity_step.get("env") != {
            "BUNDLE_ARTIFACT_ID": "${{ steps.retain-provenance-bundle.outputs.artifact-id }}",
            "BUNDLE_ARTIFACT_DIGEST": "${{ steps.retain-provenance-bundle.outputs.artifact-digest }}",
        }:
            violations.append("retained bundle identity check is not bound to upload outputs")
        command = identity_step.get("run", "")
        expected_checks = (
            '[[ "$BUNDLE_ARTIFACT_ID" =~ ^[1-9][0-9]*$ ]]',
            '[[ "$BUNDLE_ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]',
        )
        for expected_check in expected_checks:
            if expected_check not in command:
                violations.append(f"retained bundle identity check omits: {expected_check}")

    assert violations == [], "missing immutable bundle identity:\n" + "\n".join(violations)


def test_required_ci_executes_all_file_policy_hooks_fail_closed() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["test"]["steps"]
    expected_command = "uv run pre-commit run --all-files --show-diff-on-failure"
    matching_steps = [step for step in steps if step.get("run") == expected_command]
    violations: list[str] = []

    if len(matching_steps) != 1:
        violations.append("required CI does not execute every file-policy hook exactly once")
    elif matching_steps[0].get("continue-on-error") is not None:
        violations.append("required CI can ignore pre-commit hook failures")

    assert violations == [], "false-green file-policy enforcement:\n" + "\n".join(violations)


def test_pull_request_title_is_validated_as_the_squash_commit_subject() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    title_steps = [
        step
        for step in document["jobs"]["test"]["steps"]
        if step.get("name") == "Validate squash commit title"
    ]
    violations: list[str] = []

    if len(title_steps) != 1:
        violations.append("required CI has no unique squash-commit title validation step")
    else:
        step = title_steps[0]
        command = step.get("run", "")
        if step.get("if") != "github.event_name == 'pull_request'":
            violations.append("commit-title validation is not scoped to pull requests")
        if step.get("env", {}).get("PR_TITLE") != "${{ github.event.pull_request.title }}":
            violations.append("pull-request title is not passed through a shell-safe environment variable")
        if 'printf \'%s\\n\' "$PR_TITLE" > "$RUNNER_TEMP/pr-title"' not in command:
            violations.append("pull-request title is not written without shell interpolation")
        if (
            "uv run pre-commit run conventional-pre-commit --hook-stage commit-msg "
            '--commit-msg-filename "$RUNNER_TEMP/pr-title"'
        ) not in command:
            violations.append("the configured commit-message hook does not validate the squash title")
        if step.get("continue-on-error") is not None:
            violations.append("required CI can ignore an invalid squash commit title")

    assert violations == [], "false-green squash commit policy:\n" + "\n".join(violations)


def test_squash_commit_policy_rechecks_edited_pull_request_titles() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    pull_request = triggers.get("pull_request", {})
    event_types = pull_request.get("types", [])
    expected_types = {"opened", "synchronize", "reopened", "edited"}

    assert set(event_types) == expected_types, (
        "pull-request title checks can remain stale after activity changes: "
        f"expected {sorted(expected_types)!r}, found {event_types!r}"
    )


def test_workflow_token_defaults_are_explicit_and_read_only() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        permissions = document.get("permissions")
        if permissions is None:
            violations.append(f"{workflow.name}: missing top-level permissions")
            continue
        if isinstance(permissions, dict):
            for scope, access in permissions.items():
                if access == "write":
                    violations.append(f"{workflow.name}: workflow-level {scope}: write")

    assert violations == [], "over-broad workflow token defaults:\n" + "\n".join(violations)


def test_workflow_token_defaults_are_limited_to_contents_read() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        permissions = document.get("permissions")
        if permissions != {"contents": "read"}:
            violations.append(f"{workflow.name}: {permissions!r}")

    assert violations == [], "workflow token defaults exceed contents: read:\n" + "\n".join(
        violations
    )


def test_ci_dependency_installs_require_repository_locks() -> None:
    ci_workflow = (WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8")
    pages_workflow = (WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8")
    violations: list[str] = []

    if "uv sync --frozen --all-extras" not in ci_workflow:
        violations.append("ci.yml: Python dependencies are not synced from frozen uv.lock")
    if "pip install" in ci_workflow:
        violations.append("ci.yml: mutable pip dependency resolution is still enabled")
    if "bun install --frozen-lockfile" not in pages_workflow:
        violations.append("pages.yml: Bun dependencies are not installed from frozen bun.lock")

    assert violations == [], "non-deterministic CI dependency installs:\n" + "\n".join(violations)


def test_secret_scan_uses_event_specific_commit_ranges() -> None:
    workflow = (WORKFLOW_DIR / "trufflehog.yml").read_text(encoding="utf-8")
    required_ranges = (
        "base: ${{ github.event.pull_request.base.sha }}",
        "head: ${{ github.event.pull_request.head.sha }}",
        "base: ${{ github.event.before }}",
        "head: ${{ github.sha }}",
    )
    violations = [marker for marker in required_ranges if marker not in workflow]

    assert violations == [], "secret scan is missing commit range markers:\n" + "\n".join(violations)
    assert "github.event.repository.default_branch" not in workflow
    assert "head: HEAD" not in workflow


def test_checkout_credentials_are_not_persisted() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        for job_name, job in document.get("jobs", {}).items():
            for step_number, step in enumerate(job.get("steps", []), 1):
                action = step.get("uses", "")
                if action.startswith("actions/checkout@") and step.get("with", {}).get(
                    "persist-credentials"
                ) is not False:
                    violations.append(f"{workflow.name}:{job_name}:step-{step_number}")

    assert violations == [], "checkout credentials remain persisted:\n" + "\n".join(violations)


def test_pages_artifact_has_pinned_upload_and_provenance() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    build_job = document["jobs"]["build"]
    permissions = build_job.get("permissions", {})
    steps = build_job["steps"]
    actions = [step.get("uses", "") for step in steps]
    violations: list[str] = []

    if permissions.get("attestations") != "write" or permissions.get("id-token") != "write":
        violations.append("Pages build job lacks attestation permissions")
    if any(action.startswith("actions/upload-pages-artifact@") for action in actions):
        violations.append("Pages still uses a wrapper with a mutable transitive upload action")
    if not any(action.startswith("actions/attest-build-provenance@") for action in actions):
        violations.append("Pages artifact lacks build-provenance attestation")

    upload_steps = [
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    if len(upload_steps) != 1:
        violations.append("Pages must have exactly one direct artifact upload")
    else:
        upload_inputs = upload_steps[0].get("with", {})
        if upload_inputs.get("retention-days") != 1:
            violations.append("Pages artifact retention is not explicitly one day")
        if upload_inputs.get("if-no-files-found") != "error":
            violations.append("Pages upload does not fail when its artifact is missing")

    assert violations == [], "untrusted Pages artifact handoff:\n" + "\n".join(violations)


def test_pages_deployment_is_restricted_to_main_environment() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    deploy_job = document["jobs"]["deploy"]
    environment = deploy_job.get("environment", {})
    violations: list[str] = []

    if deploy_job.get("if") != "github.ref == 'refs/heads/main'":
        violations.append("Pages deployment is not restricted to refs/heads/main")
    if environment.get("name") != "github-pages":
        violations.append("Pages deployment does not use the protected github-pages environment")

    assert violations == [], "unprotected Pages deployment:\n" + "\n".join(violations)


def test_pages_deployments_serialize_without_cancellation() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    concurrency = document.get("concurrency", {})
    violations: list[str] = []

    if concurrency.get("group") != "pages":
        violations.append("Pages deployments do not share one serialization group")
    if concurrency.get("cancel-in-progress") is not False:
        violations.append("A newer Pages run can cancel an in-progress deployment")

    assert violations == [], "unsafe Pages deployment concurrency:\n" + "\n".join(violations)


def test_secret_backed_sonar_job_rejects_fork_pull_requests() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "sonarcloud.yml").read_text(encoding="utf-8"))
    sonar_job = document["jobs"]["sonar"]
    expected_condition = (
        "github.event_name != 'pull_request' || "
        "github.event.pull_request.head.repo.full_name == github.repository"
    )
    violations: list[str] = []

    if sonar_job.get("env", {}).get("SONAR_TOKEN") != "${{ secrets.SONAR_TOKEN }}":
        violations.append("Sonar job is no longer recognized as secret-backed")
    if sonar_job.get("if") != expected_condition:
        violations.append("Secret-backed Sonar job is not restricted to trusted repository refs")

    assert violations == [], "unsafe fork pull-request secret boundary:\n" + "\n".join(violations)


def test_secret_backed_sonar_runs_only_for_the_canonical_branch() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "sonarcloud.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    violations: list[str] = []

    for event_name in ("push", "pull_request"):
        branches = triggers.get(event_name, {}).get("branches")
        if branches != ["main"]:
            violations.append(f"{event_name}: secret-backed Sonar branches are {branches!r}")

    assert violations == [], "Sonar credentials exposed to non-canonical branches:\n" + "\n".join(
        violations
    )


def test_sonar_action_receives_only_its_required_service_token() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "sonarcloud.yml").read_text(encoding="utf-8"))
    job = document["jobs"]["sonar"]
    scan_step = next(
        step
        for step in job["steps"]
        if step.get("uses", "").startswith("SonarSource/sonarqube-scan-action@")
    )
    violations: list[str] = []

    if job.get("env") != {"SONAR_TOKEN": "${{ secrets.SONAR_TOKEN }}"}:
        violations.append("Sonar service token is not the job's sole explicit secret")
    if scan_step.get("env"):
        violations.append(f"Sonar action receives unnecessary step credentials: {scan_step['env']!r}")

    assert violations == [], "over-broad Sonar action credential exposure:\n" + "\n".join(violations)


def test_pages_deploy_consumes_the_attested_artifact() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    build_steps = document["jobs"]["build"]["steps"]
    deploy_steps = document["jobs"]["deploy"]["steps"]
    attest_step = next(
        step
        for step in build_steps
        if step.get("uses", "").startswith("actions/attest-build-provenance@")
    )
    upload_step = next(
        step for step in build_steps if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    deploy_step = next(
        step for step in deploy_steps if step.get("uses", "").startswith("actions/deploy-pages@")
    )
    artifact_name = upload_step.get("with", {}).get("name")
    artifact_path = upload_step.get("with", {}).get("path")
    violations: list[str] = []

    if artifact_name != "github-pages":
        violations.append("Pages producer does not use the canonical artifact name")
    if deploy_step.get("with", {}).get("artifact_name") != artifact_name:
        violations.append("Pages deploy does not explicitly select the uploaded artifact")
    if attest_step.get("with", {}).get("subject-path") != artifact_path:
        violations.append("Pages provenance subject differs from the uploaded artifact path")

    assert violations == [], "unbound Pages artifact handoff:\n" + "\n".join(violations)


def test_dependency_review_enforces_event_specific_ranges() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "dependency-review.yml").read_text(encoding="utf-8"))
    steps = document["jobs"]["dependency-review"]["steps"]
    review_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/dependency-review-action@")
    ]
    expected_ranges = {
        "github.event_name == 'pull_request'": (
            "${{ github.event.pull_request.base.sha }}",
            "${{ github.event.pull_request.head.sha }}",
        ),
        "github.event_name == 'push'": (
            "${{ github.event.before }}",
            "${{ github.sha }}",
        ),
    }
    violations: list[str] = []

    event_review_steps = [step for step in review_steps if step.get("if") in expected_ranges]
    if len(event_review_steps) != len(expected_ranges):
        violations.append("Dependency review does not have one step per supported event")
    for condition, (base_ref, head_ref) in expected_ranges.items():
        matching_steps = [step for step in review_steps if step.get("if") == condition]
        if len(matching_steps) != 1:
            violations.append(f"Dependency review is missing the {condition} range")
            continue
        inputs = matching_steps[0].get("with", {})
        if inputs.get("base-ref") != base_ref or inputs.get("head-ref") != head_ref:
            violations.append(f"Dependency review uses a mutable or incomplete {condition} range")
        if inputs.get("fail-on-severity") != "moderate" or inputs.get("warn-only") is not False:
            violations.append(f"Dependency review does not fail closed for {condition}")

    assert violations == [], "unenforced dependency review:\n" + "\n".join(violations)


def test_dependency_review_covers_merge_queue_commits() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "dependency-review.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    merge_group = triggers.get("merge_group", {})
    review_steps = [
        step
        for step in document["jobs"]["dependency-review"]["steps"]
        if step.get("uses", "").startswith("actions/dependency-review-action@")
        and step.get("if") == "github.event_name == 'merge_group'"
    ]
    violations: list[str] = []

    if merge_group.get("types") != ["checks_requested"]:
        violations.append("Dependency review does not trigger for merge queue checks")
    if len(review_steps) != 1:
        violations.append("Dependency review has no unique merge-group enforcement step")
    else:
        inputs = review_steps[0].get("with", {})
        if inputs.get("base-ref") != "${{ github.event.merge_group.base_sha }}":
            violations.append("Merge-group dependency review does not use the immutable base SHA")
        if inputs.get("head-ref") != "${{ github.event.merge_group.head_sha }}":
            violations.append("Merge-group dependency review does not use the immutable head SHA")
        if inputs.get("fail-on-severity") != "moderate" or inputs.get("warn-only") is not False:
            violations.append("Merge-group dependency review does not fail closed")

    assert violations == [], "merge queue dependency-review gap:\n" + "\n".join(violations)


def test_workflow_caches_are_published_only_from_trusted_main_pushes() -> None:
    trusted_save_condition = (
        "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    )
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        for job_name, job in document.get("jobs", {}).items():
            for step_number, step in enumerate(job.get("steps", []), 1):
                if not step.get("uses", "").startswith("Swatinem/rust-cache@"):
                    continue
                if step.get("with", {}).get("save-if") != trusted_save_condition:
                    violations.append(f"{workflow.name}:{job_name}:step-{step_number}")

    assert violations == [], "untrusted workflow cache publishers:\n" + "\n".join(violations)


def test_scorecard_sarif_handoff_is_bounded_and_fail_closed() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "scorecard.yml").read_text(encoding="utf-8"))
    job = document["jobs"]["analysis"]
    steps = job["steps"]
    scorecard_step = next(
        step for step in steps if step.get("uses", "").startswith("ossf/scorecard-action@")
    )
    artifact_step = next(
        step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    codeql_step = next(
        step for step in steps if step.get("uses", "").startswith("github/codeql-action/upload-sarif@")
    )
    expected_permissions = {
        "actions": "read",
        "contents": "read",
        "id-token": "write",
        "security-events": "write",
    }
    result_path = scorecard_step.get("with", {}).get("results_file")
    artifact_inputs = artifact_step.get("with", {})
    violations: list[str] = []

    if job.get("permissions") != expected_permissions:
        violations.append("Scorecard job permissions are not limited to required scopes")
    if artifact_inputs.get("path") != result_path:
        violations.append("Scorecard artifact upload differs from the generated SARIF path")
    if codeql_step.get("with", {}).get("sarif_file") != result_path:
        violations.append("CodeQL upload differs from the generated SARIF path")
    retention_days = artifact_inputs.get("retention-days")
    if not isinstance(retention_days, int) or not 1 <= retention_days <= 7:
        violations.append("Scorecard artifact retention is not explicitly bounded")
    if artifact_inputs.get("if-no-files-found") != "error":
        violations.append("Missing Scorecard SARIF does not fail the artifact handoff")

    assert violations == [], "unsafe Scorecard SARIF handoff:\n" + "\n".join(violations)


def test_codeql_waits_for_scorecard_processing() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "scorecard.yml").read_text(encoding="utf-8"))
    upload_step = next(
        step
        for step in document["jobs"]["analysis"]["steps"]
        if step.get("uses", "").startswith("github/codeql-action/upload-sarif@")
    )
    inputs = upload_step.get("with", {})
    violations: list[str] = []

    if inputs.get("category") != "openssf-scorecard":
        violations.append("Scorecard results do not use a stable CodeQL category")
    if inputs.get("wait-for-processing") is not True:
        violations.append("CodeQL upload can finish before Scorecard processing is accepted")

    assert violations == [], "unacknowledged Scorecard processing:\n" + "\n".join(violations)


def test_pages_provenance_credentials_are_main_only() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    build_job = document["jobs"]["build"]
    permissions = build_job.get("permissions", {})
    violations: list[str] = []

    if permissions.get("attestations") != "write" or permissions.get("id-token") != "write":
        violations.append("Pages build no longer has the required provenance permissions")
    if build_job.get("if") != "github.ref == 'refs/heads/main'":
        violations.append("Non-main code can execute in the provenance-capable Pages build job")

    assert violations == [], "over-broad Pages provenance boundary:\n" + "\n".join(violations)


def test_required_ci_runs_for_merge_queue_commits() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    merge_group = triggers.get("merge_group", {})
    violations: list[str] = []

    if merge_group.get("types") != ["checks_requested"]:
        violations.append("Required CI does not report checks for merge queue commits")
    if "pull_request" not in triggers or "push" not in triggers:
        violations.append("Required CI lost pull-request or main-push coverage")

    assert violations == [], "incomplete required CI triggers:\n" + "\n".join(violations)


def test_secret_scan_covers_merge_queue_range() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "trufflehog.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    merge_group = triggers.get("merge_group", {})
    scan_steps = [
        step
        for step in document["jobs"]["trufflehog"]["steps"]
        if step.get("uses", "").startswith("trufflesecurity/trufflehog@")
        and step.get("if") == "github.event_name == 'merge_group'"
    ]
    violations: list[str] = []

    if merge_group.get("types") != ["checks_requested"]:
        violations.append("Secret scanning does not trigger for merge queue checks")
    if len(scan_steps) != 1:
        violations.append("Secret scanning has no unique merge-group range step")
    else:
        inputs = scan_steps[0].get("with", {})
        if inputs.get("base") != "${{ github.event.merge_group.base_sha }}":
            violations.append("Merge-group secret scan does not use the immutable base SHA")
        if inputs.get("head") != "${{ github.event.merge_group.head_sha }}":
            violations.append("Merge-group secret scan does not use the immutable head SHA")
        if inputs.get("extra_args") != "--only-verified":
            violations.append("Merge-group secret scan changed its verification policy")

    assert violations == [], "merge queue secret-scan gap:\n" + "\n".join(violations)


def test_sonar_covers_merge_queue_without_weakening_fork_guard() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "sonarcloud.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    sonar_job = document["jobs"]["sonar"]
    expected_guard = (
        "github.event_name != 'pull_request' || "
        "github.event.pull_request.head.repo.full_name == github.repository"
    )
    violations: list[str] = []

    if triggers.get("merge_group", {}).get("types") != ["checks_requested"]:
        violations.append("Sonar does not trigger for merge queue checks")
    if sonar_job.get("if") != expected_guard:
        violations.append("Sonar merge-queue coverage weakened the fork pull-request guard")
    if sonar_job.get("env", {}).get("SONAR_TOKEN") != "${{ secrets.SONAR_TOKEN }}":
        violations.append("Sonar job is no longer recognized as secret-backed")

    assert violations == [], "incomplete Sonar trigger boundary:\n" + "\n".join(violations)


def test_journey_gate_covers_merge_queue_without_publishing_cache() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "journey-gate.yml").read_text(encoding="utf-8"))
    triggers = document.get("on", document.get(True, {}))
    cache_step = next(
        step
        for step in document["jobs"]["journey-gate"]["steps"]
        if step.get("uses", "").startswith("Swatinem/rust-cache@")
    )
    trusted_save_condition = (
        "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    )
    violations: list[str] = []

    if triggers.get("merge_group", {}).get("types") != ["checks_requested"]:
        violations.append("Journey evidence does not run for merge queue checks")
    if cache_step.get("with", {}).get("save-if") != trusted_save_condition:
        violations.append("Merge-queue journey validation can publish Rust cache state")

    assert violations == [], "incomplete merge-queue journey gate:\n" + "\n".join(violations)


def test_pages_uses_an_immutable_bun_version() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "pages.yml").read_text(encoding="utf-8"))
    setup_step = next(
        step
        for step in document["jobs"]["build"]["steps"]
        if step.get("uses", "").startswith("oven-sh/setup-bun@")
    )
    bun_version = setup_step.get("with", {}).get("bun-version")

    assert isinstance(bun_version, str) and re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+", bun_version
    ), f"mutable Pages Bun version: {bun_version!r}"


def test_journey_gate_uses_an_immutable_rust_toolchain() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "journey-gate.yml").read_text(encoding="utf-8"))
    setup_step = next(
        step
        for step in document["jobs"]["journey-gate"]["steps"]
        if step.get("uses", "").startswith("dtolnay/rust-toolchain@")
    )
    toolchain = setup_step.get("with", {}).get("toolchain")

    assert isinstance(toolchain, str) and re.fullmatch(
        r"1\.[0-9]+\.[0-9]+", toolchain
    ), f"mutable journey Rust toolchain: {toolchain!r}"


def test_ci_uses_an_immutable_uv_version() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    setup_step = next(
        step
        for step in document["jobs"]["test"]["steps"]
        if step.get("uses", "").startswith("astral-sh/setup-uv@")
    )
    uv_version = setup_step.get("with", {}).get("version")

    assert isinstance(uv_version, str) and re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+", uv_version
    ), f"mutable CI uv version: {uv_version!r}"


def test_ci_uses_an_immutable_python_version() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "ci.yml").read_text(encoding="utf-8"))
    setup_step = next(
        step
        for step in document["jobs"]["test"]["steps"]
        if step.get("uses", "").startswith("actions/setup-python@")
    )
    python_version = setup_step.get("with", {}).get("python-version")

    assert isinstance(python_version, str) and re.fullmatch(
        r"3\.12\.[0-9]+", python_version
    ), f"mutable CI Python version: {python_version!r}"


def test_workflow_jobs_use_explicit_ubuntu_images() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        for job_name, job in document.get("jobs", {}).items():
            runner = job.get("runs-on")
            if not isinstance(runner, str) or re.fullmatch(
                r"ubuntu-[0-9]{2}\.[0-9]{2}", runner
            ) is None:
                violations.append(f"{workflow.name}:{job_name}: {runner!r}")

    assert violations == [], "mutable or non-explicit workflow runners:\n" + "\n".join(violations)


def test_workflow_jobs_have_bounded_timeouts() -> None:
    violations: list[str] = []

    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        for job_name, job in document.get("jobs", {}).items():
            timeout = job.get("timeout-minutes")
            if (
                not isinstance(timeout, int)
                or isinstance(timeout, bool)
                or not 1 <= timeout <= 30
            ):
                violations.append(f"{workflow.name}:{job_name}: {timeout!r}")

    assert violations == [], "missing or excessive workflow timeouts:\n" + "\n".join(violations)


def test_trusted_sonar_runs_fail_closed_without_token() -> None:
    document = yaml.safe_load((WORKFLOW_DIR / "sonarcloud.yml").read_text(encoding="utf-8"))
    sonar_job = document["jobs"]["sonar"]
    steps = sonar_job["steps"]
    token_checks = [
        step
        for step in steps
        if 'test -n "$SONAR_TOKEN"' in step.get("run", "")
    ]
    scan_steps = [
        step
        for step in steps
        if step.get("uses", "").startswith("SonarSource/sonarqube-scan-action@")
    ]
    violations: list[str] = []

    if (
        sonar_job.get("env", {}).get("SONAR_TOKEN") != "${{ secrets.SONAR_TOKEN }}"
        or len(token_checks) != 1
    ):
        violations.append("Trusted Sonar runs do not fail when SONAR_TOKEN is absent")
    if len(scan_steps) != 1 or scan_steps[0].get("if") is not None:
        violations.append("The Sonar scan can still be silently skipped after job admission")

    assert violations == [], "false-green Sonar token handling:\n" + "\n".join(violations)


def test_dependabot_covers_repository_dependency_ecosystems() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    updates = document.get("updates", [])
    expected_ecosystems = {"github-actions", "pip", "npm", "pre-commit"}
    configured_ecosystems = [update.get("package-ecosystem") for update in updates]
    violations: list[str] = []

    for ecosystem in sorted(expected_ecosystems):
        matching = [
            update for update in updates if update.get("package-ecosystem") == ecosystem
        ]
        if len(matching) != 1:
            violations.append(
                f"{ecosystem}: expected one update policy, found {configured_ecosystems.count(ecosystem)}"
            )
            continue
        policy = matching[0]
        if policy.get("directory") != "/":
            violations.append(f"{ecosystem}: dependency manifest root is not covered")
        if policy.get("schedule", {}).get("interval") != "weekly":
            violations.append(f"{ecosystem}: update cadence is not bounded weekly")

    assert violations == [], "incomplete dependency update coverage:\n" + "\n".join(violations)


def test_dependabot_update_volume_is_bounded_and_grouped() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    violations: list[str] = []

    for policy in document.get("updates", []):
        ecosystem = policy.get("package-ecosystem", "unknown")
        limit = policy.get("open-pull-requests-limit")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 10:
            violations.append(f"{ecosystem}: open pull-request limit is not bounded from 1 to 10")

        groups = policy.get("groups", {})
        matching_groups = [
            name
            for name, group in groups.items()
            if group.get("patterns") == ["*"]
            and set(group.get("update-types", [])) == {"minor", "patch"}
        ]
        if len(matching_groups) != 1:
            violations.append(
                f"{ecosystem}: expected one all-dependency minor/patch update group"
            )

    assert violations == [], "unbounded Dependabot update volume:\n" + "\n".join(violations)


def test_dependabot_updates_track_default_branch_with_owned_labels() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    expected_labels = {
        "github-actions": {"dependencies", "ci"},
        "pip": {"dependencies", "python"},
        "npm": {"dependencies", "docs"},
        "pre-commit": {"dependencies", "ci"},
    }
    violations: list[str] = []

    for policy in document.get("updates", []):
        ecosystem = policy.get("package-ecosystem", "unknown")
        if "target-branch" in policy:
            violations.append(f"{ecosystem}: target branch is pinned instead of following default")
        if policy.get("rebase-strategy") != "auto":
            violations.append(f"{ecosystem}: automatic rebasing is not explicit")
        if set(policy.get("labels", [])) != expected_labels.get(ecosystem, set()):
            violations.append(f"{ecosystem}: ownership labels are incomplete or unexpected")

    assert violations == [], "unsafe Dependabot routing policy:\n" + "\n".join(violations)


def test_dependabot_version_updates_use_a_bounded_cooldown() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    violations: list[str] = []

    for policy in document.get("updates", []):
        ecosystem = policy.get("package-ecosystem", "unknown")
        cooldown = policy.get("cooldown", {})
        default_days = cooldown.get("default-days")
        if (
            not isinstance(default_days, int)
            or isinstance(default_days, bool)
            or not 3 <= default_days <= 14
        ):
            violations.append(f"{ecosystem}: default cooldown is not bounded from 3 to 14 days")
        if cooldown.get("include") != ["*"]:
            violations.append(f"{ecosystem}: cooldown does not cover every version update")
        if cooldown.get("exclude"):
            violations.append(f"{ecosystem}: cooldown exclusions bypass the review window")

    assert violations == [], "unbounded Dependabot release-adoption window:\n" + "\n".join(
        violations
    )


def test_dependabot_titles_comply_with_the_squash_commit_policy() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    expected_prefixes = {
        "github-actions": "ci",
        "pip": "build",
        "npm": "build",
        "pre-commit": "ci",
    }
    violations: list[str] = []

    for policy in document.get("updates", []):
        ecosystem = policy.get("package-ecosystem", "unknown")
        commit_message = policy.get("commit-message", {})
        if commit_message.get("prefix") != expected_prefixes.get(ecosystem):
            violations.append(f"{ecosystem}: non-conventional or unexpected title prefix")
        if commit_message.get("include") != "scope":
            violations.append(f"{ecosystem}: dependency scope is absent from generated titles")

    assert violations == [], "Dependabot titles would fail squash-commit validation:\n" + "\n".join(
        violations
    )


def test_dependabot_update_windows_are_deterministic_and_staggered() -> None:
    config_path = WORKFLOW_DIR.parent / "dependabot.yml"
    document = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    expected_windows = {
        "github-actions": ("monday", "03:00"),
        "pip": ("tuesday", "03:00"),
        "npm": ("wednesday", "03:00"),
        "pre-commit": ("thursday", "03:00"),
    }
    violations: list[str] = []

    for policy in document.get("updates", []):
        ecosystem = policy.get("package-ecosystem", "unknown")
        schedule = policy.get("schedule", {})
        expected_day, expected_time = expected_windows.get(ecosystem, (None, None))
        if schedule.get("day") != expected_day or schedule.get("time") != expected_time:
            violations.append(f"{ecosystem}: update window is not the owned staggered slot")
        if schedule.get("timezone") != "America/Los_Angeles":
            violations.append(f"{ecosystem}: update window lacks the repository timezone")

    assert violations == [], "non-deterministic Dependabot scheduling:\n" + "\n".join(violations)
