import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gatePath = resolve(repoRoot, "tools/gates/requirement-traceability.mjs");
const specPath = "tools/gates/fixtures/traceability/spec-fixture.md";
const passMatrixPath = "tools/gates/fixtures/traceability/matrix-pass.json";
let temporaryDirectory;

before(() => {
	temporaryDirectory = mkdtempSync(resolve(tmpdir(), "helios-traceability-"));
});

after(() => {
	rmSync(temporaryDirectory, { force: true, recursive: true });
});

function runGate(matrixPath = passMatrixPath, requirementsPath = specPath) {
	return spawnSync(process.execPath, [gatePath], {
		cwd: temporaryDirectory,
		env: {
			...process.env,
			TRACE_MATRIX_PATH: matrixPath,
			TRACE_SPEC_PATH: requirementsPath,
		},
		encoding: "utf8",
	});
}

function runMutatedMatrix(mutate) {
	const matrix = JSON.parse(
		readFileSync(resolve(repoRoot, passMatrixPath), "utf8"),
	);
	mutate(matrix);
	const matrixPath = resolve(temporaryDirectory, `matrix-${Date.now()}.json`);
	writeFileSync(matrixPath, JSON.stringify(matrix));
	return runGate(matrixPath);
}

test("checked mappings pass from a working directory outside the repository", () => {
	const run = runGate();
	assert.equal(run.status, 0, run.stderr);
});

test("missing requirement mappings fail closed", () => {
	const run = runGate("tools/gates/fixtures/traceability/matrix-missing.json");
	assert.equal(run.status, 1);
	assert.match(run.stderr, /missing requirement mappings for: FR-002, NFR-001/);
});

for (const kind of ["code", "tests", "evidence"]) {
	test(`missing ${kind} mappings fail closed`, () => {
		const run = runMutatedMatrix((matrix) => delete matrix.requirements[0][kind]);
		assert.equal(run.status, 1);
		assert.match(run.stderr, new RegExp(`FR-001 has no ${kind} artifacts`));
	});
}

test("a checked mapping fails when an artifact does not exist", () => {
	const run = runMutatedMatrix((matrix) => {
		matrix.requirements[0].evidence = ["tools/gates/fixtures/traceability/missing.txt"];
	});
	assert.equal(run.status, 1);
	assert.match(run.stderr, /FR-001 references missing evidence artifact/);
});

test("an unchecked mapping remains a proper red", () => {
	const run = runMutatedMatrix((matrix) => {
		matrix.requirements[0].status = "[ ]";
	});
	assert.equal(run.status, 1);
	assert.match(run.stderr, /FR-001 is unchecked/);
});

test("a missing requirements document fails with a controlled error", () => {
	const run = runGate(passMatrixPath, "tools/gates/fixtures/traceability/missing.md");
	assert.equal(run.status, 1);
	assert.match(run.stderr, /requirements file is not readable/);
});
