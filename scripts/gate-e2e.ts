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
const LOG_PATH = "/tmp/e2e.log";

export type E2EResult = {
	evidenceFound: boolean;
	exitCode: number | null;
	output: string;
};

/**
 * Evaluate Playwright evidence without relying on unstable output wording.
 */
export function evaluateE2EResult(result: E2EResult): GateFinding[] {
	if (!result.evidenceFound) {
		return [
			{
				file: "playwright",
				message: "Playwright execution evidence is missing",
				severity: "error",
				rule: "e2e-evidence-missing",
				remediation: "Run the Playwright suite and preserve its complete output log",
			},
		];
	}
	if (result.exitCode === null) {
		return [
			{
				file: "playwright",
				message: "Playwright exit status is missing",
				severity: "error",
				rule: "e2e-exit-missing",
				remediation: "Pass E2E_EXIT_CODE from the Playwright process to the report generator",
			},
		];
	}
	if (result.exitCode !== 0) {
		return [
			{
				file: "playwright",
				message: `Playwright exited with status ${result.exitCode}`,
				severity: "error",
				rule: "e2e-exit",
				remediation: "Review the preserved Playwright log and fix the failing E2E suite",
			},
		];
	}

	return [];
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	const evidenceFound = existsSync(LOG_PATH);
	const output = evidenceFound ? readFileSync(LOG_PATH, "utf-8") : "";
	const rawExitCode = process.env.E2E_EXIT_CODE;
	const parsedExitCode = rawExitCode === undefined ? Number.NaN : Number(rawExitCode);
	const exitCode = Number.isInteger(parsedExitCode) ? parsedExitCode : null;
	const findings = evaluateE2EResult({ evidenceFound, exitCode, output });
	const duration = Date.now() - startTime;

	const report = createGateReport("e2e", findings, duration);
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
