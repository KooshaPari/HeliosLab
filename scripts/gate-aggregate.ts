#!/usr/bin/env bun
/**
 * Aggregate gate reports into a pipeline summary.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
	aggregateGateReports,
	formatPipelineSummary,
	writeGateReport,
	type GateReport,
} from "./gate-report";

const REPORT_DIR = ".gate-reports";
const SUMMARY_OUTPUT = join(REPORT_DIR, "pipeline-summary.json");

/**
 * Read all gate reports from disk.
 */
function loadGateReports(): GateReport[] {
	const reports: GateReport[] = [];

	if (!existsSync(REPORT_DIR)) {
		return reports;
	}

	const files = readdirSync(REPORT_DIR);
	files
		.filter((f) => f.startsWith("gate-") && f.endsWith(".json"))
		.sort()
		.forEach((file) => {
			try {
				const path = join(REPORT_DIR, file);
				const data = JSON.parse(readFileSync(path, "utf-8"));
				reports.push(data as GateReport);
			} catch (e) {
				console.warn(`Failed to read report ${file}: ${e}`);
			}
		});

	return reports;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const reports = loadGateReports();

	if (reports.length === 0) {
		console.log("No gate reports found.");
		return;
	}

	const summary = aggregateGateReports(reports);
	writeGateReport(summary as unknown as GateReport, SUMMARY_OUTPUT);

	console.log(formatPipelineSummary(summary));

	// Write summary to stdout for GitHub Actions
	console.log("\n## Pipeline Summary");
	console.log(`Status: ${summary.status.toUpperCase()}`);
	console.log(`Total Duration: ${summary.totalDuration}ms`);
	console.log(`Gates: ${summary.gates.length}`);

	if (summary.failedGates.length > 0) {
		console.log(`Failed Gates: ${summary.failedGates.join(", ")}`);
		process.exit(1);
	}

	process.exit(0);
}

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
