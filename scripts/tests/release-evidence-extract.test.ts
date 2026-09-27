import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	checkArtifactPresence,
	SBOM_NAMES,
} from "../release-evidence-validate";
import { makeZip } from "./helpers/make-zip";

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

/**
 * The artifact name the `sbom` job in release.yml uploads under, read from
 * that workflow rather than hard-coded, so renaming it there fails the sync
 * test below instead of silently voiding the evidence gate.
 */
const RELEASED_SBOM_ARTIFACT = (() => {
	const workflow = readFileSync(
		join(import.meta.dir, "..", "..", ".github", "workflows", "release.yml"),
		"utf8",
	);
	const match = workflow.match(/^\s*artifact-name:\s*(\S+)\s*$/m);
	if (!match) {
		throw new Error(
			"no artifact-name: entry found in .github/workflows/release.yml",
		);
	}
	return match[1];
})();

let root: string;

/** Build <downloadDir>/<artifactName>/<artifactName>.zip containing `entries`. */
function makeArtifact(
	downloadDir: string,
	artifactName: string,
	entries: Record<string, string>,
) {
	const artifactDir = join(downloadDir, artifactName);
	mkdirSync(artifactDir, { recursive: true });
	// A real ZIP, not a tar renamed to .zip. `tar -a` only produces a zip on
	// Windows; on Linux bsdtar ignores -a for this case and emits a tar, which
	// unzip then rejects. The writer keeps the fixture identical everywhere.
	writeFileSync(join(artifactDir, `${artifactName}.zip`), makeZip(entries));
}

/** Run unzip, surfacing its stderr on failure instead of swallowing it. */
function unzipInto(zip: string, dest: string) {
	try {
		execFileSync("unzip", ["-o", "-q", zip, "-d", dest], { stdio: "pipe" });
	} catch (err) {
		const e = err as { stderr?: Buffer; message?: string };
		throw new Error(
			`unzip failed for ${zip}: ${e.stderr?.toString().trim() || e.message}`,
		);
	}
}

/** The original workflow traversal: only top-level *.zip. */
function extractTopLevelOnly(downloadDir: string) {
	for (const name of readdirSync(downloadDir)) {
		if (!name.endsWith(".zip")) continue;
		const zip = join(downloadDir, name);
		const dest = join(downloadDir, basename(zip, ".zip"));
		mkdirSync(dest, { recursive: true });
		unzipInto(zip, dest);
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
		unzipInto(zip, dest);
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

	it("keeps the validator's accepted SBOM names in sync with release.yml", () => {
		// The sbom job in release.yml uploads under RELEASED_SBOM_ARTIFACT, read
		// from that workflow at load time. If the name is renamed there or
		// dropped from the validator, the gate would pass vacuously, so require
		// the producer's name to be one the gate actually accepts.
		expect(SBOM_NAMES).toContain(RELEASED_SBOM_ARTIFACT);
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
