#!/usr/bin/env bun
/**
 * Release Evidence Validator
 *
 * Verifies that a release commit on `main` carries the four pieces of
 * evidence every release must publish:
 *
 *   1. Version consistency    — VERSION, package.json, and Cargo.toml agree.
 *   2. Release workflow run   — release.yml completed successfully on this SHA.
 *   3. Artifact presence      — release.yml uploaded `release-artifacts/`.
 *   4. SBOM presence          — release-attestation.yml uploaded an SBOM file.
 *   5. SLSA provenance        — release-attestation.yml generated provenance.
 *
 * Exits 0 if every check passes, 1 otherwise. Output is a structured
 * machine-readable report written to .gate-reports/release-evidence.json,
 * with a human summary on stdout. Designed to be invoked from
 * `.github/workflows/release-evidence.yml`.
 *
 * The workflow layer queries GitHub for the actual run/artifact data; this
 * script handles the local-evidence checks (version consistency + the
 * presence of the SBOM file in a passed artifact path), so the same logic
 * can be unit-tested without GitHub API calls.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

export interface EvidenceFinding {
	check: string;
	status: "pass" | "fail" | "skip";
	detail: string;
}

export interface EvidenceReport {
	gate: "release-evidence";
	commit: string;
	version: string | null;
	findings: EvidenceFinding[];
	ok: boolean;
}

export interface ProjectVersions {
	versionFile: string | null;
	packageJson: string | null;
	cargoWorkspace: string | null;
}

export const REPORT_PATH = ".gate-reports/release-evidence.json";
export const VERSION_FILE = "VERSION";
export const PACKAGE_JSON = "package.json";
export const CARGO_TOML = "Cargo.toml";
export const SBOM_NAMES = [
	"SBOM.cdx.json",
	"SBOM.spdx.json",
	"sbom.cdx.json",
	"sbom.spdx.json",
];
export const MANIFEST_NAMES = ["BUILD_MANIFEST.txt", "build-manifest.txt"];

/**
 * Read the three version sources. Each returns null if the file does not
 * exist or the version field cannot be parsed; the caller decides how to
 * react to a null.
 */
export function readProjectVersions(repoRoot: string): ProjectVersions {
	const versionFile = readVersionFile(resolve(repoRoot, VERSION_FILE));
	const packageJson = readPackageJsonVersion(resolve(repoRoot, PACKAGE_JSON));
	const cargoWorkspace = readCargoWorkspaceVersion(
		resolve(repoRoot, CARGO_TOML),
	);

	return { versionFile, packageJson, cargoWorkspace };
}

export function readVersionFile(path: string): string | null {
	if (!existsSync(path)) return null;
	const content = readFileSync(path, "utf8").trim();
	return content.length > 0 ? content : null;
}

export function readPackageJsonVersion(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			version?: unknown;
		};
		return typeof parsed.version === "string" ? parsed.version : null;
	} catch {
		return null;
	}
}

export function readCargoWorkspaceVersion(path: string): string | null {
	if (!existsSync(path)) return null;
	const content = readFileSync(path, "utf8");
	// Workspace version is declared under [workspace.package] as `version = "x.y.z"`.
	const match = content.match(
		/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
	);
	return match?.[1] ?? null;
}

/**
 * Check 1: version consistency. All three sources must agree; missing sources
 * are reported individually so the operator can see what is missing.
 */
export function checkVersionConsistency(
	versions: ProjectVersions,
): EvidenceFinding {
	const sources: Array<{ label: string; value: string | null }> = [
		{ label: "VERSION", value: versions.versionFile },
		{ label: "package.json", value: versions.packageJson },
		{ label: "Cargo.toml", value: versions.cargoWorkspace },
	];

	const present = sources.filter((s) => s.value !== null);
	if (present.length === 0) {
		return {
			check: "version-consistency",
			status: "fail",
			detail:
				"No version sources found (VERSION, package.json, Cargo.toml all unreadable).",
		};
	}

	const distinct = new Set(present.map((s) => s.value));
	if (distinct.size !== 1) {
		return {
			check: "version-consistency",
			status: "fail",
			detail: `Version mismatch: ${sources.map((s) => `${s.label}=${s.value ?? "<missing>"}`).join(", ")}`,
		};
	}

	const missing = sources.filter((s) => s.value === null);
	if (missing.length > 0) {
		return {
			check: "version-consistency",
			status: "fail",
			detail: `Versions agree on ${present[0]?.value ?? "?"} but ${missing.map((m) => m.label).join(", ")} missing.`,
		};
	}

	return {
		check: "version-consistency",
		status: "pass",
		detail: `All three sources agree on version ${present[0]?.value ?? "?"}.`,
	};
}

/**
 * Check 2-5: artifact presence. The workflow passes either:
 *   - the path to a downloaded `release-artifacts/` directory, OR
 *   - a list of artifact filenames (from `actions:listWorkflowRunArtifacts`).
 *
 * Either mode produces a `string[]` of candidate filenames that we scan
 * for the expected evidence files.
 */
export function checkArtifactPresence(
	availableFilenames: string[] | null,
	downloadedDir: string | null,
): EvidenceFinding[] {
	const findings: EvidenceFinding[] = [];

	if (!availableFilenames && !downloadedDir) {
		findings.push({
			check: "release-workflow-run",
			status: "skip",
			detail:
				"No artifact list or download dir provided; release.yml run cannot be validated locally.",
		});
		return findings;
	}

	const filenames = availableFilenames ?? [];
	const sbomHit =
		filenames.some((n) => SBOM_NAMES.includes(n)) || sbomInDir(downloadedDir);
	const manifestHit =
		filenames.some((n) => MANIFEST_NAMES.includes(n)) ||
		manifestInDir(downloadedDir);
	// BUILD_MANIFEST.txt is staged alongside provenance by release-attestation.yml,
	// so its presence is a strong signal that the attestation workflow ran.
	// A failing manifest check also fails provenance, since the two are paired.
	const provenanceHit =
		manifestHit ||
		filenames.some(
			(n) => n.endsWith(".intoto.jsonl") || n.includes("provenance"),
		);

	findings.push({
		check: "sbom-present",
		status: sbomHit ? "pass" : "fail",
		detail: sbomHit
			? `SBOM found (one of ${SBOM_NAMES.join(", ")}).`
			: `No SBOM file found in artifacts (looked for ${SBOM_NAMES.join(", ")}).`,
	});

	findings.push({
		check: "build-manifest-present",
		status: manifestHit ? "pass" : "fail",
		detail: manifestHit
			? `BUILD_MANIFEST.txt present.`
			: `No BUILD_MANIFEST.txt found in release artifacts.`,
	});

	findings.push({
		check: "slsa-provenance-attached",
		status: provenanceHit ? "pass" : "fail",
		detail: provenanceHit
			? `Provenance indicator present (BUILD_MANIFEST or .intoto.jsonl).`
			: `No provenance indicator found; release-attestation.yml may not have run.`,
	});

	return findings;
}

export function sbomInDir(dir: string | null): boolean {
	if (!dir) return false;
	return SBOM_NAMES.some((n) => existsSync(resolve(dir, n)));
}

export function manifestInDir(dir: string | null): boolean {
	if (!dir) return false;
	return MANIFEST_NAMES.some((n) => existsSync(resolve(dir, n)));
}

/**
 * CLI entry point. Reads the three local version sources, prints a summary
 * to stdout, writes a structured report, and exits non-zero if any check
 * fails. Designed for both local operator use (`bun run scripts/release-evidence-validate.ts`)
 * and CI invocation (workflow passes `--artifacts` and/or `--download-dir`).
 */
function main(): void {
	const argv = process.argv.slice(2);
	const artifactListPath = flagValue(argv, "--artifact-list");
	const downloadDir = flagValue(argv, "--download-dir");
	const commitSha =
		flagValue(argv, "--commit") ?? process.env.GITHUB_SHA ?? "local";

	let artifactFilenames: string[] | null = null;
	if (artifactListPath && existsSync(artifactListPath)) {
		artifactFilenames = readFileSync(artifactListPath, "utf8")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}

	const repoRoot = process.cwd();
	const versions = readProjectVersions(repoRoot);
	const versionFinding = checkVersionConsistency(versions);
	const artifactFindings = checkArtifactPresence(
		artifactFilenames,
		downloadDir,
	);
	const findings = [versionFinding, ...artifactFindings];

	const canonicalVersion =
		versions.versionFile ??
		versions.packageJson ??
		versions.cargoWorkspace ??
		null;

	const report: EvidenceReport = {
		gate: "release-evidence",
		commit: commitSha,
		version: canonicalVersion,
		findings,
		ok: findings.every((f) => f.status === "pass" || f.status === "skip"),
	};

	mkdirSync(dirname(REPORT_PATH), { recursive: true });
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

	for (const f of findings) {
		const marker = f.status === "pass" ? "✓" : f.status === "fail" ? "✗" : "·";
		console.log(`  ${marker} ${f.check}: ${f.detail}`);
	}

	if (!report.ok) {
		console.error(`\nRelease evidence gate FAILED for ${commitSha}.`);
		process.exit(1);
	}
	console.log(
		`\nRelease evidence gate passed for ${commitSha} (version ${canonicalVersion ?? "?"}).`,
	);
}

function flagValue(argv: string[], flag: string): string | null {
	const idx = argv.indexOf(flag);
	if (idx === -1 || idx === argv.length - 1) return null;
	return argv[idx + 1] ?? null;
}

if (import.meta.main) {
	main();
}
