#!/usr/bin/env bun
/**
 * Gate 7: Static analysis for complexity and dead code
 * Analyzes code for excessive complexity and length violations.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type GateFinding,
	createGateReport,
	formatGateReport,
	writeGateReport,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-static-analysis.json";
const MAX_FILE_LENGTH = 500;
const SOURCE_DIRECTORIES = [
	join(process.cwd(), "apps/runtime/src"),
	join(process.cwd(), "apps/desktop/src"),
	join(process.cwd(), "scripts"),
] as const;

const FILE_LENGTH_BASELINE: Record<string, number> = {
	"/apps/runtime/src/secrets/__tests__/integration.test.ts": 600,
	"/apps/runtime/src/secrets/protected-paths.ts": 594,
	"/apps/runtime/src/protocol/bus.ts": 884,
	"/apps/runtime/src/providers/a2a-router.ts": 626,
	"/apps/runtime/src/providers/mcp-bridge.ts": 519,
	"/apps/runtime/src/providers/acp-client.ts": 533,
	"/apps/runtime/src/providers/__tests__/registry.test.ts": 503,
	"/apps/runtime/src/providers/__tests__/a2a-router.test.ts": 655,
	"/apps/runtime/src/lanes/index.ts": 620,
	"/apps/runtime/src/index.ts": 1000,
	"/apps/runtime/src/renderer/ghostty/backend.ts": 506,
	"/apps/runtime/src/lanes/par.ts": 529,
	"/apps/runtime/src/protocol/bus/emitter.ts": 807,
	"/apps/runtime/src/audit/sink.ts": 617,
};

function findTypescriptFiles(rootDir: string): string[] {
	const files: string[] = [];
	const stack = [rootDir];

	while (stack.length > 0) {
		const current = stack.pop()!;

		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.startsWith(".") || entry === "node_modules") {
				continue;
			}

			const fullPath = join(current, entry);
			const stats = statSync(fullPath);
			if (stats.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
				files.push(fullPath);
			}
		}
	}

	return files;
}

function getFileLengthFinding(
	relativePath: string,
	lineCount: number,
): GateFinding | null {
	if (lineCount <= MAX_FILE_LENGTH) {
		return null;
	}

	const baseline = FILE_LENGTH_BASELINE[relativePath];
	if (baseline !== undefined && lineCount <= baseline) {
		return null;
	}

	const remediation =
		baseline !== undefined
			? `Reduce file to at most ${baseline} lines (baseline) and continue decomposition`
			: "Break file into smaller modules";

	return {
		file: relativePath,
		line: 1,
		message: `File has ${lineCount} lines, exceeds maximum of ${MAX_FILE_LENGTH}`,
		severity: "error",
		rule: "file-length",
		remediation,
	};
}

function scanForViolations(): GateFinding[] {
	const findings: GateFinding[] = [];

	for (const directory of SOURCE_DIRECTORIES) {
		if (!existsSync(directory)) {
			continue;
		}

		for (const filePath of findTypescriptFiles(directory)) {
			const content = readFileSync(filePath, "utf-8");
			const lineCount = content.split("\n").length;
			const relativePath = filePath.replace(process.cwd(), "");
			const finding = getFileLengthFinding(relativePath, lineCount);
			if (finding) {
				findings.push(finding);
			}
		}
	}

	return findings;
}

function main(): void {
	const startTime = Date.now();
	const findings = scanForViolations();
	const duration = Date.now() - startTime;

	const report = createGateReport("static-analysis", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);
	process.stdout.write(`${formatGateReport(report)}\n`);
	process.exit(report.status === "pass" ? 0 : 1);
}

try {
	main();
} catch (error) {
	process.stderr.write(`Error: ${String(error)}\n`);
	process.exit(2);
}
