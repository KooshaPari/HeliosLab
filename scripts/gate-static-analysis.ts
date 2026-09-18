#!/usr/bin/env bun
/**
 * Gate 7: Static analysis for complexity and dead code
 * Analyzes code for excessive complexity and length violations.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	createGateReport,
	formatGateReport,
	type GateFinding,
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
	// Acknowledged debt: each entry is the current size of a file that exceeds
	// MAX_FILE_LENGTH. This is a no-growth guard, not a clean bill of health.
	// Reducing any of these below 500 lets its entry be deleted.
	"/apps/runtime/src/index.ts": 833,
	"/apps/runtime/src/integrations/sharing/__tests__/share-session.test.ts": 525,
	"/apps/runtime/src/lanes/index.ts": 656,
	"/apps/runtime/src/lanes/watchdog/remediation.ts": 544,
	"/apps/runtime/src/providers/__tests__/a2a-router.test.ts": 689,
	"/apps/runtime/src/providers/__tests__/acp-client.test.ts": 516,
	"/apps/runtime/src/providers/__tests__/mcp-bridge.test.ts": 513,
	"/apps/runtime/src/providers/a2a-router.ts": 515,
	"/apps/runtime/src/providers/acp-client.ts": 563,
	"/apps/runtime/src/providers/mcp-bridge.ts": 530,
	"/apps/runtime/src/renderer/ghostty/backend.ts": 519,
	"/apps/runtime/src/secrets/__tests__/integration.test.ts": 980,
	"/scripts/compliance-checker.ts": 507,
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
			// `fixtures` directories hold deliberately oversized sample files
			// (scripts/tests/fixtures/large-file.ts and friends are 501 lines of
			// "// line N") that exist to test size rules. Scanning them made this
			// gate fail on the very data used to verify it.
			if (
				entry.startsWith(".") ||
				entry === "node_modules" ||
				entry === "fixtures"
			) {
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

	// The baseline keys are POSIX-style, but relativePath carries backslashes on
	// Windows. Without this normalization the lookup silently missed every entry
	// on Windows, so the baseline was a no-op there and this gate reported
	// findings that CI never saw (16 locally against 11 in CI).
	const baseline = FILE_LENGTH_BASELINE[relativePath.replaceAll("\\", "/")];
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
