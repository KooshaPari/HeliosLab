import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseLiteralArray(tsPath, constName) {
	const source = readFileSync(tsPath, "utf8");
	const regex = new RegExp(
		`export const ${constName} = \\[(?<body>[\\s\\S]*?)\\] as const;`,
	);
	const match = source.match(regex);
	if (!match?.groups?.body) {
		throw new Error(`Unable to parse ${constName} from ${tsPath}`);
	}
	return [...match.groups.body.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function ensure(condition, errors, message) {
	if (!condition) {
		errors.push(message);
	}
}

function collectNames(entries) {
	return new Set(entries.map((entry) => entry.name));
}

function validateMatrixEntries(kind, formalEntries, matrixEntries, errors) {
	const allowedStatuses = new Set(["implemented", "deferred", "extension"]);
	const formalSet = new Set(formalEntries);
	const matrixNames = matrixEntries.map((entry) => entry?.name);

	for (const entry of matrixEntries) {
		ensure(
			typeof entry?.name === "string" && entry.name.length > 0,
			errors,
			`${kind} matrix entry missing name`,
		);
		ensure(
			allowedStatuses.has(entry?.status),
			errors,
			`${kind} '${entry?.name ?? "<missing>"}' has invalid status '${entry?.status}'`,
		);
		ensure(
			Array.isArray(entry?.contract_refs) && entry.contract_refs.length > 0,
			errors,
			`${kind} '${entry?.name ?? "<missing>"}' missing contract_refs`,
		);
		ensure(
			Array.isArray(entry?.runtime_refs) && entry.runtime_refs.length > 0,
			errors,
			`${kind} '${entry?.name ?? "<missing>"}' missing runtime_refs`,
		);
		ensure(
			Array.isArray(entry?.task_ids) && entry.task_ids.length > 0,
			errors,
			`${kind} '${entry?.name ?? "<missing>"}' missing task_ids`,
		);

		if (entry?.status === "deferred") {
			ensure(
				entry.task_ids.some((taskId) => /^T\d{3}$/.test(taskId)),
				errors,
				`${kind} '${entry.name}' deferred status requires Txxx task_ids`,
			);
		}
	}

	const duplicates = matrixNames.filter(
		(name, index) => name && matrixNames.indexOf(name) !== index,
	);
	for (const duplicate of new Set(duplicates)) {
		errors.push(`${kind} '${duplicate}' duplicated in parity matrix`);
	}

	const missingFromMatrix = formalEntries.filter(
		(entry) => !collectNames(matrixEntries).has(entry),
	);
	for (const missing of missingFromMatrix) {
		errors.push(`Formal ${kind} '${missing}' missing from parity matrix`);
	}

	const unknownInMatrix = matrixEntries
		.map((entry) => entry.name)
		.filter((entry) => entry && !formalSet.has(entry));
	for (const unknown of unknownInMatrix) {
		errors.push(`Parity matrix ${kind} '${unknown}' is not in formal surface`);
	}
}

const args = process.argv.slice(2);
const fixtureRootArgIndex = args.indexOf("--fixture-root");
const fixtureRoot =
	fixtureRootArgIndex >= 0 ? args[fixtureRootArgIndex + 1] : ".";
const root = resolve(fixtureRoot ?? ".");

const runtimeTopics = parseLiteralArray(
	resolve(root, "apps/runtime/src/protocol/topics.ts"),
	"TOPICS",
);
const runtimeMethods = parseLiteralArray(
	resolve(root, "apps/runtime/src/protocol/methods.ts"),
	"METHODS",
);
const formalTopics = readJson(
	resolve(root, "specs/protocol/v1/topics.json"),
).topics;
const formalMethods = readJson(
	resolve(root, "specs/protocol/v1/methods.json"),
).methods;
const matrix = readJson(
	resolve(
		root,
		"kitty-specs/001-colab-agent-terminal-control-plane/contracts/protocol-parity-matrix.json",
	),
);
const contract = readJson(
	resolve(
		root,
		"kitty-specs/001-colab-agent-terminal-control-plane/contracts/orchestration-envelope.schema.json",
	),


);

const contractMethods = (contract.properties?.method?.enum ?? []).filter(
	Boolean,
);
const contractTopics = (contract.properties?.topic?.enum ?? []).filter(Boolean);

const errors = [];

const runtimeOnlyMethods = runtimeMethods.filter(
	(method) => !formalMethods.includes(method),
);
const runtimeOnlyTopics = runtimeTopics.filter(
	(topic) => !formalTopics.includes(topic),
);
const formalOnlyMethods = formalMethods.filter(
	(method) => !runtimeMethods.includes(method),
);
const formalOnlyTopics = formalTopics.filter(
	(topic) => !runtimeTopics.includes(topic),
);
const formalOnlyContractMethods = formalMethods.filter(
	(method) => !contractMethods.includes(method),
);
const formalOnlyContractTopics = formalTopics.filter(
	(topic) => !contractTopics.includes(topic),
);

if (runtimeOnlyMethods.length > 0) {
	errors.push(
		`Runtime-only methods missing from formal assets: ${runtimeOnlyMethods.join(", ")}`,
	);
}
if (runtimeOnlyTopics.length > 0) {
	errors.push(
		`Runtime-only topics missing from formal assets: ${runtimeOnlyTopics.join(", ")}`,
	);
}
if (formalOnlyMethods.length > 0) {
	errors.push(
		`Formal-only methods missing from runtime assets: ${formalOnlyMethods.join(", ")}`,
	);
}
if (formalOnlyTopics.length > 0) {
	errors.push(
		`Formal-only topics missing from runtime assets: ${formalOnlyTopics.join(", ")}`,
	);
}
if (formalOnlyContractMethods.length > 0) {
	errors.push(
		`Formal methods missing from contract schema enum: ${formalOnlyContractMethods.join(", ")}`,
	);
}
if (formalOnlyContractTopics.length > 0) {
	errors.push(
		`Formal topics missing from contract schema enum: ${formalOnlyContractTopics.join(", ")}`,
	);
}

validateMatrixEntries("method", formalMethods, matrix.methods ?? [], errors);
validateMatrixEntries("topic", formalTopics, matrix.topics ?? [], errors);

if (errors.length > 0) {
	process.stderr.write("Protocol parity gate failed.\n");
	for (const message of errors) {
		process.stderr.write(`- ${message}\n`);
	}
	process.exit(1);
}

process.stdout.write("Protocol parity gate passed.\n");
