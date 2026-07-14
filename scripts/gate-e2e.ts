#!/usr/bin/env bun
/**
 * Gate 4: Playwright E2E Test report generator
 * Parses Playwright output and generates structured JSON report
 */

import { readFileSync, existsSync } from "fs";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-e2e.json";

/**
 * Parse Playwright test output for failures.
 */
function parseE2ELog(): GateFinding[] {
	const findings: GateFinding[] = [];
	const logPath = "/tmp/e2e.log";

	if (!existsSync(logPath)) {
		return findings;
	}

	const output = readFileSync(logPath, "utf-8");

	// Detect test failures
	if (output.includes("failed") || output.includes("FAILED")) {
		findings.push({
			file: "playwright",
			message: "E2E test failures detected",
			severity: "error",
			rule: "e2e-failure",
			remediation: "Review Playwright test failures and fix failing tests",
		});
	}

	// Detect timeout issues
	if (output.includes("timeout") || output.includes("Timeout")) {
		findings.push({
			file: "playwright",
			message: "E2E test timeout detected",
			severity: "error",
			rule: "e2e-timeout",
			remediation: "Increase timeout or optimize test performance",
		});
	}

	return findings;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	const findings = parseE2ELog();
	const duration = Date.now() - startTime;

	const report = createGateReport("e2e", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));
	process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
