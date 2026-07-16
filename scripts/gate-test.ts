#!/usr/bin/env bun
/**
 * Gate 3: Unit Test report generator
 * Parses test output and generates structured JSON report
 */

import { readFileSync, existsSync } from "fs";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-test.json";

/**
 * Parse test output for failures and skipped tests.
 */
export function parseTestLog(logPath = "/tmp/test.log"): GateFinding[] {
	if (!existsSync(logPath)) {
		return [
			{
				file: logPath,
				message: "Unit test output is missing",
				severity: "error",
				rule: "test-evidence-missing",
				remediation: "Run the complete unit test command and capture its output",
			},
		];
	}

	return parseTestOutput(readFileSync(logPath, "utf-8"));
}

export function parseTestOutput(output: string): GateFinding[] {
	const findings: GateFinding[] = [];
	const lines = output.split("\n");

	// Detect .skip, .only, .todo markers in test output
	lines.forEach((line, index) => {
		if (
			line.includes(".skip") ||
			line.includes(".only") ||
			line.includes(".todo")
		) {
			findings.push({
				file: "test",
				line: index + 1,
				message: `Test uses restricted marker: ${line.trim()}`,
				severity: "error",
				rule: "no-test-markers",
				remediation: "Remove .skip, .only, or .todo markers",
			});
		}
	});

	// Detect test failures: look for "FAIL" or "✖" markers
	if (
		output.includes("FAIL") ||
		output.includes("✖") ||
		/^\(fail\)\s+/m.test(output) ||
		/\b[1-9]\d*\s+fail(?:ed)?\b/i.test(output)
	) {
		findings.push({
			file: "test-suite",
			message: "Test failures detected in output",
			severity: "error",
			rule: "test-failure",
			remediation: "Fix the failing test and rerun the complete unit test suite",
		});
	}

	return findings;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	const findings = parseTestLog();
	const duration = Date.now() - startTime;

	const report = createGateReport("test", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));
	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`Error: ${e}`);
		process.exit(2);
	});
}
