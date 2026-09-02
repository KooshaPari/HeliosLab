import { readFileSync, existsSync } from "node:fs";

const specPath =
	process.env.TRACE_SPEC_PATH ??
	"kitty-specs/001-colab-agent-terminal-control-plane/spec.md";
const matrixPath =
	process.env.TRACE_MATRIX_PATH ??
	"kitty-specs/001-colab-agent-terminal-control-plane/traceability-matrix.json";

function extractRequirementIds(specText) {
	const matches = [...specText.matchAll(/\*\*((?:FR|NFR)-[0-9]+[a-z]?)\*\*/g)];
	return [...new Set(matches.map((match) => match[1]))];
}

function fail(message) {
	console.error(`Requirement traceability gate failed: ${message}`);
	process.exit(1);
}

const specText = readFileSync(specPath, "utf8");
const requirementIds = extractRequirementIds(specText);
if (!requirementIds.length) {
	fail(`no FR/NFR identifiers found in ${specPath}`);
}

const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
if (!Array.isArray(matrix.requirements)) {
	fail(`matrix file ${matrixPath} must contain a requirements array`);
}

const byId = new Map(matrix.requirements.map((entry) => [entry.id, entry]));
const missing = requirementIds.filter((id) => !byId.has(id));
if (missing.length) {
	fail(`missing mappings for: ${missing.join(", ")}`);
}

const broken = [];
for (const id of requirementIds) {
	const entry = byId.get(id);
	if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0) {
		broken.push(`${id} has no artifacts`);
		continue;
	}

	for (const artifact of entry.artifacts) {
		if (typeof artifact !== "string" || artifact.length === 0) {
			broken.push(`${id} has invalid artifact entry`);
			continue;
		}
		if (!existsSync(artifact)) {
			broken.push(`${id} references missing artifact ${artifact}`);
		}
	}
}

if (broken.length) {
	fail(broken.join("; "));
}

console.log(
	`Requirement traceability gate passed for ${requirementIds.length} requirements.`,
);
