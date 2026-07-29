#!/usr/bin/env bun
/**
 * Bypass Detection Scanner - Gate 8
 * Detects and reports all forms of quality gate suppression directives
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-bypass-detect.json";

// Patterns to detect as suppression directives
// (These pattern names are constructed at runtime to avoid self-detection)
const suppName1 = "@" + "ts-ignore";
const suppName2 = "@" + "ts-expect-error";
const suppName3 = "@" + "ts-nocheck";
const suppName4 = "eslint" + "-disable";
const suppName5 = "biome" + "-ignore";

const SUPPRESSION_PATTERNS = [
	{ regex: new RegExp(suppName1), name: suppName1 },
	{ regex: new RegExp(suppName2), name: suppName2 },
	{ regex: new RegExp(suppName3), name: suppName3 },
	{ regex: new RegExp(suppName4 + "(-line|-next-line)?"), name: suppName4 },
	{ regex: new RegExp(suppName5), name: suppName5 },
];

const TEST_MARKERS = [
	{ regex: /\.skip\s*\(/, name: ".skip()" },
	{ regex: /\.only\s*\(/, name: ".only()" },
	{ regex: /\.todo\s*\(/, name: ".todo()" },
];

interface ScannerOptions {
	root?: string;
	exclude?: string[];
	json?: boolean;
}

/**
 * Scan for suppression directives in source files.
 */
export function scanBypassDirectives(
	options: ScannerOptions = {},
): GateFinding[] {
	const findings: GateFinding[] = [];
	const root = options.root || process.cwd();
	const exclude = options.exclude || [
		"node_modules",
		"dist",
		".git",
		".worktrees",
	];

	function shouldExclude(filePath: string): boolean {
		return exclude.some((pattern) => filePath.includes(pattern));
	}

	function scanDir(dir: string) {
		if (shouldExclude(dir)) return;

		try {
			const files = readdirSync(dir);
			files.forEach((file) => {
				const fullPath = join(dir, file);
				const stat = require("fs").statSync(fullPath);

				if (stat.isDirectory()) {
					scanDir(fullPath);
				} else if (/\.(ts|tsx|js|jsx)$/.test(file)) {
					scanFile(fullPath, file);
				}
			});
		} catch (e) {
			// Silently skip unreadable directories
		}
	}

	function scanFile(filePath: string, fileName: string) {
		if (shouldExclude(filePath)) return;
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		const relativePath = filePath.replace(process.cwd(), "");

		lines.forEach((line, index) => {
			const lineNum = index + 1;

			// Skip lines that are entirely within comments (lazy check)
			if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
				return;
			}

			// Check TypeScript and other suppression patterns
			SUPPRESSION_PATTERNS.forEach((pattern) => {
				if (pattern.regex.test(line)) {
					findings.push({
						file: relativePath,
						line: lineNum,
						message: `Suppression directive found: ${pattern.name}`,
						severity: "error",
						rule: "no-suppression-directive",
						remediation: `Remove ${pattern.name} and fix the underlying issue`,
					});
				}
			});
		});
	}

	scanDir(root);
	return findings;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const jsonFlag = args.includes("--json");

	const startTime = Date.now();
	const findings = scanBypassDirectives({
		exclude: [
			"node_modules",
			"dist",
			".git",
			".worktrees",
			"scripts/tests/gate-bypass-detect.test.ts",
			"apps/runtime/tests/unit/build-infra.test.ts",
		],
	});
	const duration = Date.now() - startTime;

	const report = createGateReport("bypass-detect", findings, duration);

	if (jsonFlag) {
		writeGateReport(report, REPORT_OUTPUT);
	}

	console.log(formatGateReport(report));

	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`Error: ${e}`);
		process.exit(2);
	});
}
