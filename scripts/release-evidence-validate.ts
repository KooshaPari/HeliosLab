#!/usr/bin/env bun
/**
 * Release Evidence Validator
 *
 * Verifies that a release commit on `main` carries the four pieces of
 * evidence every release must publish:
 *
 *   1. Version consistency    — VERSION, package.json, and Cargo.toml agree.
 *   2. SBOM presence          — at least one SBOM file (CycloneDX or SPDX)
 *                               exists in the downloaded release artifacts.
 *   3. BUILD_MANIFEST presence — `BUILD_MANIFEST.txt` exists in the artifacts,
 *                               proving the release pipeline ran to completion.
 *   4. SLSA provenance        — an `.intoto.jsonl` file (or
 *                               `*.intoto.jsonl`) is present in the artifacts,
 *                               proving `release-attestation.yml` produced a
 *                               provenance attestation.
 *
 * Exits 0 if every check passes (or all skip), 1 otherwise. Output is a
 * structured machine-readable report written to
 * `.gate-reports/release-evidence.json`, with a human summary on stdout.
 *
 * The workflow layer (`release-evidence.yml`) is responsible for
 * downloading the release artifacts into a single directory before
 * invoking this script. The validator only does local filesystem checks
 * so the same logic can be unit-tested with fixtures without GitHub API
 * access. The workflow not finding any release run is reported as a
 * skip with a clear message; the validator cannot produce a meaningful
 * pass/fail for a missing run on its own.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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
export const PROVENANCE_SUFFIX = ".intoto.jsonl";

/**
 * Whether any of `files` (relative paths from `listFilesRecursive`)
 * matches `basenames` by basename. Files downloaded into per-artifact
 * subdirectories (`<download-dir>/<artifact-name>/<file>`) are common,
 * so we accept either an exact relative-path match or a basename match.
 */
export function anyFileMatchesBasenames(
	files: string[],
	basenames: string[],
): boolean {
	const set = new Set(basenames);
	for (const f of files) {
		const base = f.split("/").pop() ?? f;
		if (set.has(base)) return true;
	}
	return false;
}

/**
 * Read the three local version sources. Returns nulls for missing or
 * unreadable files; the caller decides how to react.
 */
export function readProjectVersions(repoRoot: string): ProjectVersions {
	return {
		versionFile: readVersionFile(resolve(repoRoot, VERSION_FILE)),
		packageJson: readPackageJsonVersion(resolve(repoRoot, PACKAGE_JSON)),
		cargoWorkspace: readCargoWorkspaceVersion(resolve(repoRoot, CARGO_TOML)),
	};
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
 * Recursively list every regular file under `dir`, returning paths
 * relative to `dir` using forward slashes. Returns an empty array if
 * the directory does not exist. The `dir` argument is expected to be
 * downloaded release artifacts (or any directory layout of evidence
 * files).
 */
export function listFilesRecursive(dir: string | null): string[] {
	if (!dir || !existsSync(dir)) return [];
	const found: string[] = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (entry.isFile()) {
				// Compute path relative to `dir`, then normalize to
				// forward slashes so cross-platform callers receive a
				// consistent shape (Windows backslashes are converted).
				const rel = relative(dir, entryPath).split(sep).join("/");
				found.push(rel);
			}
		}
	}
	return found;
}

/**
 * Check 1: version consistency. All three sources must agree on the
 * same version. Missing files are reported in the detail message so the
 * operator can see which source is the problem.
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
			detail: `Version mismatch: ${sources
				.map((s) => `${s.label}=${s.value ?? "<missing>"}`)
				.join(", ")}`,
		};
	}

	const missing = sources.filter((s) => s.value === null);
	if (missing.length > 0) {
		return {
			check: "version-consistency",
			status: "fail",
			detail: `Versions agree on ${present[0]?.value ?? "?"} but ${missing
				.map((m) => m.label)
				.join(", ")} missing.`,
		};
	}

	return {
		check: "version-consistency",
		status: "pass",
		detail: `All three sources agree on version ${present[0]?.value ?? "?"}.`,
	};
}

/**
 * Checks 2-4: artifact presence inside the downloaded directory.
 *
 * The workflow downloads all artifacts from a release.yml run (plus
 * release-attestation.yml artifacts for provenance) into a single
 * directory before invoking this script. We scan that directory for
 * the well-known evidence filenames. If the directory is not provided
 * or does not exist, every check is `skip` — meaning the workflow
 * could not acquire artifacts at all — rather than `fail`, because the
 * validator alone cannot distinguish "no artifacts yet" from "no
 * artifacts uploaded".
 */
export function checkArtifactPresence(
	downloadedDir: string | null,
): EvidenceFinding[] {
	if (!downloadedDir || !existsSync(downloadedDir)) {
		return [
			{
				check: "sbom-present",
				status: "skip",
				detail:
					"No downloaded artifact directory provided; SBOM cannot be verified locally. The workflow layer reports whether the release run produced artifacts.",
			},
			{
				check: "build-manifest-present",
				status: "skip",
				detail:
					"No downloaded artifact directory provided; BUILD_MANIFEST cannot be verified locally.",
			},
			{
				check: "slsa-provenance-attached",
				status: "skip",
				detail:
					"No downloaded artifact directory provided; SLSA provenance cannot be verified locally.",
			},
		];
	}

	const files = listFilesRecursive(downloadedDir);
	if (files.length === 0) {
		return [
			{
				check: "sbom-present",
				status: "fail",
				detail: `Downloaded artifact directory ${downloadedDir} is empty.`,
			},
			{
				check: "build-manifest-present",
				status: "fail",
				detail: `Downloaded artifact directory ${downloadedDir} is empty.`,
			},
			{
				check: "slsa-provenance-attached",
				status: "fail",
				detail: `Downloaded artifact directory ${downloadedDir} is empty.`,
			},
		];
	}

	const sbomHit = anyFileMatchesBasenames(files, SBOM_NAMES);
	const manifestHit = anyFileMatchesBasenames(files, MANIFEST_NAMES);
	const provenanceHit = files.some((f) => f.endsWith(PROVENANCE_SUFFIX));

	return [
		{
			check: "sbom-present",
			status: sbomHit ? "pass" : "fail",
			detail: sbomHit
				? `SBOM file present in artifacts (one of ${SBOM_NAMES.join(", ")}).`
				: `No SBOM file found in downloaded artifacts (looked for ${SBOM_NAMES.join(", ")}).`,
		},
		{
			check: "build-manifest-present",
			status: manifestHit ? "pass" : "fail",
			detail: manifestHit
				? `BUILD_MANIFEST.txt present in downloaded artifacts.`
				: `No BUILD_MANIFEST.txt found in downloaded artifacts.`,
		},
		{
			check: "slsa-provenance-attached",
			status: provenanceHit ? "pass" : "fail",
			detail: provenanceHit
				? `SLSA provenance (${PROVENANCE_SUFFIX}) present in downloaded artifacts.`
				: `No ${PROVENANCE_SUFFIX} file in downloaded artifacts; release-attestation.yml may not have run.`,
		},
	];
}

/**
 * CLI entry point. Reads the three local version sources and scans the
 * downloaded-artifact directory passed in `--download-dir`. Prints a
 * summary, writes a structured report, and exits non-zero if any check
 * fails. Designed for both local operator use and CI invocation.
 */
function main(): void {
	const argv = process.argv.slice(2);
	const downloadDir = flagValue(argv, "--download-dir");
	const commitSha =
		flagValue(argv, "--commit") ?? process.env.GITHUB_SHA ?? "local";

	const repoRoot = process.cwd();
	const versions = readProjectVersions(repoRoot);
	const versionFinding = checkVersionConsistency(versions);
	const artifactFindings = checkArtifactPresence(downloadDir);
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
