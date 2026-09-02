#!/usr/bin/env bun
/**
 * Gate 1: TypeScript Typecheck report generator
 * Parses tsc output and generates structured JSON report
 */

import { readFileSync, existsSync } from "fs";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-typecheck.json";

/**
 * Parse tsc error output from log file.
 */
function parseTypeCheckLog(): GateFinding[] {
	const findings: GateFinding[] = [];
	const logPath = "/tmp/typecheck.log";

	if (!existsSync(logPath)) {
		return findings;
	}

	const output = readFileSync(logPath, "utf-8");
	const lines = output.split("\n");

	// Parse tsc error format: file.ts(line,col): error TS####: message
	const errorPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(\w+):\s+(.+)$/;

	lines.forEach((line) => {
		const match = line.match(errorPattern);
		if (match) {
			const [, file, lineNum, col, code, message] = match;
			findings.push({
				file,
				line: parseInt(lineNum, 10),
				column: parseInt(col, 10) - 1,
				message,
				severity: "error",
				rule: code,
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
	const findings = parseTypeCheckLog();
	const duration = Date.now() - startTime;

	const report = createGateReport("typecheck", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));
	process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
