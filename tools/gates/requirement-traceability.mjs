import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SPEC_PATH = "FUNCTIONAL_REQUIREMENTS.md";
const DEFAULT_MATRIX_PATH = "docs/reference/functional-requirements-traceability.json";
const ARTIFACT_KINDS = ["code", "tests", "evidence"];

export function extractRequirementIds(specText) {
	const matches = [
		...specText.matchAll(/\*\*((?:FR|NFR)(?:-[A-Z0-9]+)+[a-z]?)\*\*/g),
	];
	return [...new Set(matches.map((match) => match[1]))];
}

function fromRoot(path, repoRoot) {
	return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function readText(path, label, errors) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		errors.push(`${label} is not readable: ${error.message}`);
		return undefined;
	}
}

function artifactExists(path, repoRoot) {
	const absolutePath = fromRoot(path, repoRoot);
	return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

function formatIds(ids) {
	const displayed = ids.slice(0, 10).join(", ");
	const remainder = ids.length - 10;
	return remainder > 0 ? `${displayed} (+${remainder} more)` : displayed;
}

function formatIdCount(label, ids) {
	return `${label} (${ids.length}): ${formatIds(ids)}`;
}

export function validateTraceability({ specPath, matrixPath, repoRoot = REPO_ROOT }) {
	const errors = [];
	const absoluteSpecPath = fromRoot(specPath, repoRoot);
	const absoluteMatrixPath = fromRoot(matrixPath, repoRoot);
	const specText = readText(absoluteSpecPath, "requirements file", errors);
	const matrixText = readText(absoluteMatrixPath, "matrix file", errors);
	if (specText === undefined || matrixText === undefined) {
		return errors;
	}

	const requirementIds = extractRequirementIds(specText);
	if (requirementIds.length === 0) {
		errors.push(`no FR/NFR identifiers found in ${specPath}`);
		return errors;
	}

	let matrix;
	try {
		matrix = JSON.parse(matrixText);
	} catch (error) {
		errors.push(`matrix file is not valid JSON: ${error.message}`);
		return errors;
	}
	if (!Array.isArray(matrix.requirements)) {
		errors.push("matrix must contain a requirements array");
		return errors;
	}

	const byId = new Map();
	for (const entry of matrix.requirements) {
		if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
			errors.push("matrix contains a requirement without a valid id");
			continue;
		}
		if (byId.has(entry.id)) {
			errors.push(`duplicate mapping for ${entry.id}`);
		}
		byId.set(entry.id, entry);
	}

	const required = new Set(requirementIds);
	const missing = requirementIds.filter((id) => !byId.has(id));
	if (missing.length > 0) {
		errors.push(formatIdCount("missing requirement mappings", missing));
	}
	const unknown = [...byId.keys()].filter((id) => !required.has(id));
	if (unknown.length > 0) {
		errors.push(formatIdCount("matrix contains unknown requirements", unknown));
	}

	for (const id of requirementIds) {
		const entry = byId.get(id);
		if (!entry) continue;

		if (entry.status !== "[x]" && entry.status !== "[ ]") {
			errors.push(`${id} status must be [x] or [ ]`);
		} else if (entry.status === "[ ]") {
			errors.push(`${id} is unchecked`);
		}

		for (const kind of ARTIFACT_KINDS) {
			const artifacts = entry[kind];
			if (!Array.isArray(artifacts) || artifacts.length === 0) {
				errors.push(`${id} has no ${kind} artifacts`);
				continue;
			}
			for (const artifact of artifacts) {
				if (typeof artifact !== "string" || artifact.trim().length === 0) {
					errors.push(`${id} has an invalid ${kind} artifact`);
				} else if (!artifactExists(artifact, repoRoot)) {
					errors.push(`${id} references missing ${kind} artifact ${artifact}`);
				}
			}
		}
	}

	return errors;
}

export function main() {
	const specPath = process.env.TRACE_SPEC_PATH ?? DEFAULT_SPEC_PATH;
	const matrixPath = process.env.TRACE_MATRIX_PATH ?? DEFAULT_MATRIX_PATH;
	const errors = validateTraceability({ specPath, matrixPath });
	if (errors.length > 0) {
		for (const error of errors) {
			console.error(`Requirement traceability gate failed: ${error}`);
		}
		return 1;
	}
	console.log("Requirement traceability gate passed with complete checked mappings.");
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = main();
}
