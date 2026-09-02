#!/usr/bin/env bun
/**
 * Gate 2: OXC Lint report generator
 * Parses OXC linter output and generates structured JSON report
 */

import { readFileSync, existsSync } from "fs";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-lint.json";

/**
 * Parse OXC lint output from log file.
 */
function parseLintLog(): GateFinding[] {
	const findings: GateFinding[] = [];
	const logPath = "/tmp/lint.log";

	if (!existsSync(logPath)) {
		return findings;
	}

	const output = readFileSync(logPath, "utf-8");
	const lines = output.split("\n");

	// Parse OXC error format: file.ts:line:col - error|warning|info: message (rule)
	// or file.ts:line:col - error: message
	const errorPattern =
		/^(.+?):(\d+):(\d+)\s+-\s+(error|warning|info):\s+(.+?)(?:\s+\((\w+)\))?$/i;

	lines.forEach((line) => {
		const match = line.match(errorPattern);
		if (match) {
			const [, file, lineNum, col, severity, message, rule] = match;
			findings.push({
				file,
				line: parseInt(lineNum, 10),
				column: parseInt(col, 10) - 1,
				message,
				severity: severity.toLowerCase() as "error" | "warning" | "info",
				rule: rule || undefined,
			});
		}
	});

	return findings;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	const findings = parseLintLog();
	const duration = Date.now() - startTime;

	const report = createGateReport("lint", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));
	process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
