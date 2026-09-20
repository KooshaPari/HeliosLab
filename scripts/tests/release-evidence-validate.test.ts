import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CARGO_TOML,
	checkArtifactPresence,
	checkVersionConsistency,
	MANIFEST_NAMES,
	PACKAGE_JSON,
	readCargoWorkspaceVersion,
	readPackageJsonVersion,
	readProjectVersions,
	readVersionFile,
	SBOM_NAMES,
	VERSION_FILE,
} from "../release-evidence-validate";

/**
 * Tests for the release-evidence validator. Exercises every check with
 * fixture filesystem state; no network or git history required.
 */

const VERSION_LINE = "0.14.11-canary.3";

function writeFixture(root: string, files: Record<string, string>) {
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(root, name), content);
	}
}

describe("readVersionFile", () => {
	test("returns trimmed content when file exists", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFileSync(join(dir, VERSION_FILE), "0.14.11-canary.3\n");
		expect(readVersionFile(join(dir, VERSION_FILE))).toBe(VERSION_LINE);
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null when file does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		expect(readVersionFile(join(dir, "missing"))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null when file is empty", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFileSync(join(dir, VERSION_FILE), "   \n");
		expect(readVersionFile(join(dir, VERSION_FILE))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("readPackageJsonVersion", () => {
	test("reads the version field from a package.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFixture(dir, {
			[PACKAGE_JSON]: JSON.stringify({ name: "x", version: VERSION_LINE }),
		});
		expect(readPackageJsonVersion(join(dir, PACKAGE_JSON))).toBe(VERSION_LINE);
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null when version field is not a string", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFixture(dir, { [PACKAGE_JSON]: JSON.stringify({ version: 42 }) });
		expect(readPackageJsonVersion(join(dir, PACKAGE_JSON))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null on invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFixture(dir, { [PACKAGE_JSON]: "{ not json" });
		expect(readPackageJsonVersion(join(dir, PACKAGE_JSON))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("readCargoWorkspaceVersion", () => {
	test("reads version under [workspace.package]", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFixture(dir, {
			[CARGO_TOML]: `[workspace]\nresolver = "2"\nmembers = ["a", "b"]\n\n[workspace.package]\nversion = "${VERSION_LINE}"\nedition = "2021"\n`,
		});
		expect(readCargoWorkspaceVersion(join(dir, CARGO_TOML))).toBe(VERSION_LINE);
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null when no [workspace.package] block", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFixture(dir, {
			[CARGO_TOML]: '[package]\nname = "x"\nversion = "9.9.9"\n',
		});
		expect(readCargoWorkspaceVersion(join(dir, CARGO_TOML))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("readProjectVersions", () => {
	let repoRoot: string;
	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "rev-"));
	});
	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	test("returns nulls when no files exist", () => {
		const v = readProjectVersions(repoRoot);
		expect(v.versionFile).toBeNull();
		expect(v.packageJson).toBeNull();
		expect(v.cargoWorkspace).toBeNull();
	});

	test("returns all three versions when all files exist", () => {
		writeFixture(repoRoot, {
			[VERSION_FILE]: `${VERSION_LINE}\n`,
			[PACKAGE_JSON]: JSON.stringify({ version: VERSION_LINE }),
			[CARGO_TOML]: `[workspace.package]\nversion = "${VERSION_LINE}"\n`,
		});
		const v = readProjectVersions(repoRoot);
		expect(v.versionFile).toBe(VERSION_LINE);
		expect(v.packageJson).toBe(VERSION_LINE);
		expect(v.cargoWorkspace).toBe(VERSION_LINE);
	});
});

describe("checkVersionConsistency", () => {
	test("passes when all three sources agree", () => {
		const result = checkVersionConsistency({
			versionFile: VERSION_LINE,
			packageJson: VERSION_LINE,
			cargoWorkspace: VERSION_LINE,
		});
		expect(result.status).toBe("pass");
		expect(result.detail).toContain("agree");
	});

	test("fails when VERSION disagrees with the other two", () => {
		const result = checkVersionConsistency({
			versionFile: "0.14.11-canary.1",
			packageJson: VERSION_LINE,
			cargoWorkspace: VERSION_LINE,
		});
		expect(result.status).toBe("fail");
		expect(result.detail).toContain("VERSION=0.14.11-canary.1");
		expect(result.detail).toContain("package.json=0.14.11-canary.3");
		expect(result.detail).toContain("Cargo.toml=0.14.11-canary.3");
	});

	test("fails when one source is missing", () => {
		const result = checkVersionConsistency({
			versionFile: null,
			packageJson: VERSION_LINE,
			cargoWorkspace: VERSION_LINE,
		});
		expect(result.status).toBe("fail");
		expect(result.detail).toContain("VERSION");
		expect(result.detail).toContain("missing");
	});

	test("fails when all sources are missing", () => {
		const result = checkVersionConsistency({
			versionFile: null,
			packageJson: null,
			cargoWorkspace: null,
		});
		expect(result.status).toBe("fail");
		expect(result.detail).toContain("No version sources found");
	});
});

describe("checkArtifactPresence", () => {
	test("returns skip finding when no inputs provided", () => {
		const findings = checkArtifactPresence(null, null);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.status).toBe("skip");
		expect(findings[0]?.check).toBe("release-workflow-run");
	});

	test("passes SBOM and manifest when filenames list contains them", () => {
		const findings = checkArtifactPresence(
			["SBOM.cdx.json", "BUILD_MANIFEST.txt", "phenoctl"],
			null,
		);
		const sbom = findings.find((f) => f.check === "sbom-present");
		const manifest = findings.find((f) => f.check === "build-manifest-present");
		const provenance = findings.find(
			(f) => f.check === "slsa-provenance-attached",
		);
		expect(sbom?.status).toBe("pass");
		expect(manifest?.status).toBe("pass");
		expect(provenance?.status).toBe("pass");
	});

	test("fails SBOM when no SBOM filename in list and no download dir", () => {
		const findings = checkArtifactPresence(["phenoctl", "phenoctl.exe"], null);
		const sbom = findings.find((f) => f.check === "sbom-present");
		expect(sbom?.status).toBe("fail");
	});

	test("fails when no BUILD_MANIFEST present", () => {
		const findings = checkArtifactPresence(["SBOM.cdx.json", "phenoctl"], null);
		const manifest = findings.find((f) => f.check === "build-manifest-present");
		expect(manifest?.status).toBe("fail");
	});

	test("detects SBOM from downloaded directory even with empty filename list", () => {
		const dir = mkdtempSync(join(tmpdir(), "rev-"));
		writeFileSync(
			join(dir, SBOM_NAMES[0] as string),
			'{"bomFormat":"CycloneDX"}',
		);
		writeFileSync(join(dir, MANIFEST_NAMES[0] as string), "manifest");

		const findings = checkArtifactPresence([], dir);
		const sbom = findings.find((f) => f.check === "sbom-present");
		const manifest = findings.find((f) => f.check === "build-manifest-present");
		const provenance = findings.find(
			(f) => f.check === "slsa-provenance-attached",
		);
		expect(sbom?.status).toBe("pass");
		expect(manifest?.status).toBe("pass");
		expect(provenance?.status).toBe("pass");
		rmSync(dir, { recursive: true, force: true });
	});

	test("detects provenance via .intoto.jsonl file", () => {
		const findings = checkArtifactPresence(
			["SBOM.cdx.json", "BUILD_MANIFEST.txt", "release.intoto.jsonl"],
			null,
		);
		const provenance = findings.find(
			(f) => f.check === "slsa-provenance-attached",
		);
		expect(provenance?.status).toBe("pass");
	});
});
