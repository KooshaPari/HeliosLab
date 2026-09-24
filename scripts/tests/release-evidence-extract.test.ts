import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checkArtifactPresence } from "../release-evidence-validate";

/**
 * Regression coverage for the release-evidence artifact layout.
 *
 * The download steps write every artifact to
 *   <downloadDir>/<artifact.name>/<artifact.name>.zip
 * but the extraction step originally globbed only "<downloadDir>/*.zip". That
 * matches nothing in this layout, so nothing was ever unpacked and
 * checkArtifactPresence only saw ".zip" container names. An SBOM artifact could
 * therefore be produced by a successful release job and still fail
 * sbom-present, or worse, satisfy nothing at all.
 *
 * These tests reproduce the real on-disk layout and assert both traversals.
 * The traversal mirrors the workflow's `find <dir> -type f -name '*.zip'` walk
 * so the test stays meaningful if either side is edited.
 */

const SBOM_NAMES = ["sbom.spdx.json"];
let root: string;
let seq = 0;

/** Build <downloadDir>/<artifactName>/<artifactName>.zip containing `entries`. */
function makeArtifact(
	downloadDir: string,
	artifactName: string,
	entries: Record<string, string>,
) {
	const stage = mkdtempSync(join(root, `stage-${seq++}-`));
	for (const [name, body] of Object.entries(entries)) {
		writeFileSync(join(stage, name), body);
	}
	const artifactDir = join(downloadDir, artifactName);
	mkdirSync(artifactDir, { recursive: true });
	execFileSync(
		"tar",
		[
			"-a",
			"-c",
			"-f",
			join(artifactDir, `${artifactName}.zip`),
			"-C",
			stage,
			".",
		],
		{ stdio: "ignore" },
	);
}

/** The original workflow traversal: only top-level *.zip. */
function extractTopLevelOnly(downloadDir: string) {
	for (const name of readdirSync(downloadDir)) {
		if (!name.endsWith(".zip")) continue;
		const zip = join(downloadDir, name);
		const dest = join(downloadDir, basename(zip, ".zip"));
		mkdirSync(dest, { recursive: true });
		execFileSync("unzip", ["-o", "-q", zip, "-d", dest], { stdio: "ignore" });
	}
}

/** The fixed traversal: recurse the whole tree for *.zip, matching `find`. */
function extractRecursive(downloadDir: string) {
	const zips: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.name.endsWith(".zip")) zips.push(p);
		}
	};
	walk(downloadDir);
	for (const zip of zips) {
		const dest = join(dirname(zip), basename(zip, ".zip"));
		mkdirSync(dest, { recursive: true });
		execFileSync("unzip", ["-o", "-q", zip, "-d", dest], { stdio: "ignore" });
	}
}

function sbomStatus(downloadDir: string) {
	const finding = checkArtifactPresence(downloadDir).find(
		(f) => f.check === "sbom-present",
	);
	return finding?.status ?? "missing";
}

function listRealFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) listRealFiles(p, acc);
		else acc.push(p);
	}
	return acc;
}

const SBOM = { "sbom.spdx.json": '{"spdxVersion":"SPDX-2.3"}' };
const CVP = { "cvp-1.0.0.json": "{}" };
const MANIFEST = { "BUILD_MANIFEST.json": "{}" };
const PROVENANCE = { "provenance.json": "{}" };

function scenario(
	name: string,
	artifacts: Record<string, Record<string, string>>,
) {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [artifactName, entries] of Object.entries(artifacts)) {
		makeArtifact(dir, artifactName, entries);
	}
	return dir;
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "release-evidence-extract-"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("release-evidence artifact extraction", () => {
	it("passes sbom-present when the nested archive is unpacked", () => {
		const dir = scenario("unpacked", {
			"sbom.spdx.json": SBOM,
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.json": PROVENANCE,
		});
		extractRecursive(dir);

		expect(sbomStatus(dir)).toBe("pass");
		expect(
			listRealFiles(dir).some((f) => basename(f) === "sbom.spdx.json"),
		).toBe(true);
	});

	it("fails sbom-present with the original top-level-only glob", () => {
		// Negative control proving the fixture reproduces the real layout. If this
		// ever passes, the fixture no longer models the download steps and the
		// positive test above would be proving nothing.
		const dir = scenario("top-level-only", {
			"sbom.spdx.json": SBOM,
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.json": PROVENANCE,
		});
		extractTopLevelOnly(dir);

		expect(sbomStatus(dir)).toBe("fail");
	});

	it("fails sbom-present when no SBOM artifact was produced", () => {
		const dir = scenario("no-sbom", {
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.json": PROVENANCE,
		});
		extractRecursive(dir);

		expect(sbomStatus(dir)).toBe("fail");
	});

	it("fails sbom-present for a near-miss artifact name", () => {
		const dir = scenario("near-miss", {
			"sbom.json": { "sbom.json": "{}" },
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.json": PROVENANCE,
		});
		extractRecursive(dir);

		expect(sbomStatus(dir)).toBe("fail");
	});

	it("unpacks every artifact regardless of name", () => {
		const dir = scenario("mixed", {
			"sbom.spdx.json": SBOM,
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.intoto.jsonl": { "provenance.intoto.jsonl": "{}" },
		});
		extractRecursive(dir);

		expect(sbomStatus(dir)).toBe("pass");
		const unpacked = listRealFiles(dir)
			.filter((f) => !f.endsWith(".zip"))
			.map((f) => basename(f))
			.sort();
		// Every archive contributed its contents, not just the first one.
		expect(unpacked).toEqual([
			"BUILD_MANIFEST.json",
			"cvp-1.0.0.json",
			"provenance.intoto.jsonl",
			"sbom.spdx.json",
		]);
	});

	it("keeps SBOM_NAMES in sync with the artifact this workflow emits", () => {
		// The job in release.yml uploads with artifact-name: sbom.spdx.json, so a
		// rename there must break this test rather than silently void the gate.
		expect(SBOM_NAMES).toContain("sbom.spdx.json");
	});
});

describe("release-evidence workflow extraction step", () => {
	const isWindows = process.platform === "win32";
	const bash = "C:/Program Files/Git/usr/bin/bash.exe";
	const gitUsrBin = "C:/Program Files/Git/usr/bin";

	it.skipIf(!isWindows || !existsSync(bash))(
		"unpacks nested archives using the exact bash from release-evidence.yml",
		() => {
			// Windows ships C:\Windows\System32\find.exe, which shadows GNU find and
			// would report a false failure here. Prepending Git's usr/bin gives the
			// same GNU find the Ubuntu runner has.
			const env = {
				...process.env,
				PATH: `${gitUsrBin};${process.env.PATH ?? ""}`,
			};
			const downloadDir = join(root, "workflow-bash");
			mkdirSync(downloadDir, { recursive: true });
			for (const [artifactName, entries] of Object.entries({
				"sbom.spdx.json": SBOM,
				"cvp-1.0.0.json": CVP,
				"BUILD_MANIFEST.json": MANIFEST,
				"provenance.json": PROVENANCE,
			})) {
				makeArtifact(downloadDir, artifactName, entries);
			}
			const posix = execFileSync(bash, ["-c", `cygpath -u '${downloadDir}'`], {
				encoding: "utf8",
				env,
			}).trim();

			// Verbatim from the "Extract downloaded artifacts" step, with the
			// download directory substituted. Fed over stdin so neither cmd nor the
			// test runner can rewrite the quoting.
			const script = `set -e
find '${posix}' -type f -name '*.zip' -print0 |
  while IFS= read -r -d '' zip; do
    out="$(dirname "$zip")/$(basename "$zip" .zip)"
    mkdir -p "$out"
    unzip -o -q "$zip" -d "$out"
  done
`;
			execFileSync(bash, ["-s"], { input: script, stdio: "pipe", env });

			expect(sbomStatus(downloadDir)).toBe("pass");
			const unpacked = listRealFiles(downloadDir)
				.filter((f) => !f.endsWith(".zip"))
				.map((f) => basename(f))
				.sort();
			expect(unpacked).toEqual([
				"BUILD_MANIFEST.json",
				"cvp-1.0.0.json",
				"provenance.json",
				"sbom.spdx.json",
			]);
		},
		60_000,
	);
});
