import { existsSync, readFileSync } from "node:fs";

const specPath =
	process.env.TRACE_SPEC_PATH ??
	"docs/specs/001-colab-agent-terminal-control-plane/spec.md";
const matrixPath =
	process.env.TRACE_MATRIX_PATH ??
	".archive/kitty-specs/001-colab-agent-terminal-control-plane/traceability-matrix.json";

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
// Matrix entries may split one requirement into lettered sub-requirements
// (FR-001 -> FR-001a, FR-001b). A spec ID is mapped when the matrix contains
// either the exact ID or one or more of its lettered splits.
const mapped = requirementIds.filter((id) =>
	[...byId.keys()].some(
		(matrixId) =>
			matrixId === id ||
			(matrixId.startsWith(`${id}`) &&
				/^[a-z]$/.test(matrixId.slice(id.length))),
	),
);
const missing = requirementIds.filter((id) => !mapped.includes(id));
if (missing.length) {
	fail(`missing mappings for: ${missing.join(", ")}`);
}

const broken = [];
const mappedIds = new Set(
	requirementIds.flatMap((id) =>
		[...byId.keys()].filter(
			(matrixId) =>
				matrixId === id ||
				(matrixId.startsWith(id) && /^[a-z]+$/.test(matrixId.slice(id.length))),
		),
	),
);
for (const id of mappedIds) {
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
