import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
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

const REPO_ROOT = join(import.meta.dir, "..", "..");

function readWorkflow(name: string): string {
	try {
		return readFileSync(join(REPO_ROOT, ".github", "workflows", name), "utf8");
	} catch (e) {
		throw new Error(
			`could not read .github/workflows/${name}: ${(e as Error).message}`,
		);
	}
}

/**
 * The shell of the "Extract downloaded artifacts" step, read out of
 * release-evidence.yml rather than pasted here.
 *
 * A pasted copy silently goes stale: when the step gained `set -eo
 * pipefail` the test kept asserting the old `set -e` and its "verbatim"
 * claim became false while still reading as coverage. Reading it at test
 * time means a change to the workflow is a change to what runs.
 *
 * Both failures here are deliberate rather than incidental. The body
 * indent is derived from the `run: |` line so a step nested one level
 * deeper still parses, and the `run:` search is bounded by the next step
 * so a step that loses its `run:` key fails here instead of silently
 * adopting the following step's script. Neither throws at module load,
 * so a workflow edit cannot take the rest of this file's tests with it.
 */
function readExtractionStep(): string {
	const lines = readWorkflow("release-evidence.yml").split("\n");
	const step = lines.findIndex((l) =>
		l.includes("- name: Extract downloaded artifacts"),
	);
	if (step === -1)
		throw new Error("Extract downloaded artifacts step not found");

	// The step runs until the next sibling key, which is the next
	// "- name:" at this step's own indent.
	const stepIndent = lines[step].length - lines[step].trimStart().length || 0;
	let end = step + 1;
	while (end < lines.length) {
		const l = lines[end];
		const indent = l.length - l.trimStart().length;
		if (l.trim() !== "" && indent <= stepIndent) break;
		end++;
	}

	const run = lines.findIndex(
		(l, i) => i > step && i < end && l.trimStart().startsWith("run:"),
	);
	if (run === -1)
		throw new Error(
			`Extract downloaded artifacts step (lines ${step + 1}-${end}) has no "run:" key`,
		);

	// The body of a block scalar is indented past its own key, so the
	// key's indent is the right base regardless of how deep the step sits.
	const indent = " ".repeat(
		lines[run].length - lines[run].trimStart().length + 2,
	);
	const body: string[] = [];
	for (let i = run + 1; i < end; i++) {
		const line = lines[i];
		if (line.trim() !== "" && !line.startsWith(indent)) break;
		body.push(line.slice(indent.length));
	}
	if (body.length === 0)
		throw new Error(`Extraction step "run:" block at line ${run + 1} is empty`);
	return body.join("\n");
}

/** Path the workflow hard-codes; the tests substitute a temp dir for it. */
const EXTRACTION_DOWNLOAD_DIR = "/tmp/release-evidence-artifacts";

/**
 * The step's shell with the workflow's download directory replaced.
 * Throws rather than returning a half-substituted script, so a renamed
 * download path surfaces as a failure instead of unzipping /tmp.
 */
function extractionScriptFor(dir: string): string {
	const script = readExtractionStep().replace(
		EXTRACTION_DOWNLOAD_DIR,
		`'${dir}'`,
	);
	if (script.includes(EXTRACTION_DOWNLOAD_DIR)) {
		throw new Error(
			`extraction step no longer hard-codes ${EXTRACTION_DOWNLOAD_DIR}, so the test cannot redirect it; update EXTRACTION_DOWNLOAD_DIR`,
		);
	}
	return script;
}

/**
 * The artifact name the `sbom` job in release.yml uploads under, read from
 * that workflow rather than hard-coded, so renaming it there fails the sync
 * test below instead of silently voiding the evidence gate.
 */
const RELEASED_SBOM_ARTIFACT = (() => {
	const workflow = readFileSync(
		join(REPO_ROOT, ".github", "workflows", "release.yml"),
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
	const gitBash = "C:/Program Files/Git/usr/bin/bash.exe";
	const gitUsrBin = "C:/Program Files/Git/usr/bin";

	/**
	 * Run the step's own shell against a real download tree.
	 *
	 * On POSIX this uses /bin/bash directly, which is the binary the
	 * ubuntu-24.04 runner that executes release-evidence.yml actually uses.
	 * On Windows it uses Git's bash, because C:\Windows\System32\find.exe
	 * shadows GNU find there and would report a false failure.
	 */
	function runExtraction(
		downloadDir: string,
	): { bash: string; posixDir: string } | null {
		let bash: string;
		let posixDir: string;
		let env: Record<string, string> = { ...process.env } as Record<
			string,
			string
		>;
		if (isWindows) {
			if (!existsSync(gitBash)) return null;
			env = { ...env, PATH: `${gitUsrBin};${process.env.PATH ?? ""}` };
			posixDir = execFileSync(gitBash, ["-c", `cygpath -u '${downloadDir}'`], {
				encoding: "utf8",
				env,
			}).trim();
			bash = gitBash;
		} else {
			bash = "/bin/bash";
			posixDir = downloadDir;
		}
		execFileSync(bash, ["-s"], {
			input: extractionScriptFor(posixDir),
			stdio: "pipe",
			env,
		});
		return { bash, posixDir };
	}

	/** Build <dir>/<artifact>/<artifact>.zip, the layout the downloads produce. */
	function seedDownloadTree(dir: string): void {
		mkdirSync(dir, { recursive: true });
		for (const [artifactName, entries] of Object.entries({
			"sbom.spdx.json": SBOM,
			"cvp-1.0.0.json": CVP,
			"BUILD_MANIFEST.json": MANIFEST,
			"provenance.json": PROVENANCE,
		})) {
			makeArtifact(dir, artifactName, entries);
		}
	}

	const expectedUnpacked = [
		"BUILD_MANIFEST.json",
		"cvp-1.0.0.json",
		"provenance.json",
		"sbom.spdx.json",
	];

	it("unpacks every nested archive when run on this platform", () => {
		// This is the real coverage: the step's own shell, read out of the
		// workflow and executed against the real download layout. It runs on
		// the ubuntu-24.04 runner as well as here, so a semantically broken
		// step fails CI rather than waiting for a release.
		const downloadDir = join(root, "workflow-bash");
		seedDownloadTree(downloadDir);
		const result = runExtraction(downloadDir);
		if (result === null) {
			// Git's bash is absent on this Windows box; the POSIX path above
			// still covers CI. Skip rather than pass vacuously.
			console.warn("skipping: Git bash not found at " + gitBash);
			return;
		}
		expect(sbomStatus(downloadDir)).toBe("pass");
		expect(
			listRealFiles(downloadDir)
				.filter((f) => !f.endsWith(".zip"))
				.map((f) => basename(f))
				.sort(),
		).toEqual(expectedUnpacked);
	}, 60_000);

	it("fails the step when the download tree contains a corrupt archive", () => {
		// Behavioural check that the step's shell options actually bite, and
		// the direct negative control for `set -eo pipefail`: without it, a
		// failing unzip inside the while body is masked and the step exits 0.
		//
		// Truncation, not appended garbage: unzip tolerates trailing bytes
		// after the end-of-central-directory record and still exits 0, so an
		// append-based control passes vacuously. Cutting the archive in half
		// destroys the central directory and makes unzip exit 9.
		const downloadDir = join(root, "workflow-bash-corrupt");
		seedDownloadTree(downloadDir);
		const victim = join(downloadDir, "cvp-1.0.0.json", "cvp-1.0.0.json.zip");
		const bytes = readFileSync(victim);
		writeFileSync(victim, bytes.subarray(0, Math.floor(bytes.length / 2)));
		expect(() => runExtraction(downloadDir)).toThrow();
	}, 60_000);

	it("parses the step body regardless of how deeply the step is nested", () => {
		// The parser derives the body indent from the `run:` key rather than
		// hard-coding 10 spaces, so this passes even if the step is moved
		// under an extra `with:` or job wrapper.
		const script = readExtractionStep();
		expect(script).toContain(EXTRACTION_DOWNLOAD_DIR);
		expect(script).toContain("unzip");
		// A body that lost its find/unzip would parse to something empty of
		// behaviour; require the actual traversal and extraction calls.
		expect(script).toMatch(/find\b/);
		expect(script).toMatch(/unzip\b/);
	});
});
