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
function parseTestLog(): GateFinding[] {
	const findings: GateFinding[] = [];
	const logPath = "/tmp/test.log";

	if (!existsSync(logPath)) {
		return findings;
	}

	const output = readFileSync(logPath, "utf-8");
	const lines = output.split("\n");

	// Detect .skip, .only, .todo markers in test output
	lines.forEach((line) => {
		if (
			line.includes(".skip") ||
			line.includes(".only") ||
			line.includes(".todo")
		) {
			findings.push({
				file: "test",
				message: `Test uses restricted marker: ${line.trim()}`,
				severity: "error",
				rule: "no-test-markers",
				remediation: "Remove .skip, .only, or .todo markers",
			});
		}
	});

	// Detect test failures: look for "FAIL" or "✖" markers
	if (output.includes("FAIL") || output.includes("✖")) {
		findings.push({
			file: "test-suite",
			message: "Test failures detected in output",
			severity: "error",
			rule: "test-failure",
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

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
