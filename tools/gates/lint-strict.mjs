import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/runtime/src", "apps/runtime/tests"];
const files = collectTsFiles(roots);
const failures = [];

const blocked = [
	{
		pattern: /@ts-ignore|@ts-nocheck/,
		message: "TypeScript bypass comments are forbidden",
	},
	{
		pattern: /eslint-disable/,
		message: "eslint-disable bypass comments are forbidden",
	},
	{
		pattern: /semgrep:\s*ignore/,
		message: "semgrep ignore comments are forbidden",
	},
	{
		pattern: /\b(test|describe|it)\.only\b/,
		message: "Focused tests are forbidden",
	},
	{ pattern: /\bany\b/, message: "any is forbidden in strict gate" },
];

for (const file of files) {
	const source = readFileSync(file, "utf8");
	for (const rule of blocked) {
		if (rule.pattern.test(source)) {
			failures.push(`${file}: ${rule.message}`);
		}
	}
}

if (failures.length > 0) {
	console.error("Strict lint gate failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log(`Strict lint gate passed for ${files.length} files.`);

function collectTsFiles(paths) {
	const output = [];
	for (const path of paths) {
		walk(path, output);
	}
	return output;
}

function walk(path, output) {
	for (const entry of readdirSync(path)) {
		const absolute = join(path, entry);
		const stats = statSync(absolute);
		if (stats.isDirectory()) {
			walk(absolute, output);
			continue;
		}
		if (absolute.endsWith(".ts")) {
			output.push(absolute);
		}
	}
}
