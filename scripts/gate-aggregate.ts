#!/usr/bin/env bun
/**
 * Aggregate gate reports into a pipeline summary.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import {
	aggregateGateReports,
	createGateReport,
	formatGateReport,
	formatPipelineSummary,
	readGateReport,
	writeGateReport,
	type GateReport,
} from "./gate-report";

const REPORT_DIR = ".gate-reports";
const SUMMARY_OUTPUT = join(REPORT_DIR, "pipeline-summary.json");
const AGGREGATION_ERROR_OUTPUT = join(REPORT_DIR, "aggregation-error.json");

export function createAggregationFailureReport(error: unknown): GateReport {
	const message = error instanceof Error ? error.message : String(error);
	return createGateReport(
		"aggregate",
		[
			{
				file: REPORT_DIR,
				message,
				severity: "error",
				remediation:
					"Regenerate every gate report and correct malformed or missing report evidence.",
			},
		],
		0,
	);
}

/**
 * Read all gate reports from disk.
 */
export function loadGateReports(reportDirectory = REPORT_DIR): GateReport[] {
	const reports: GateReport[] = [];

	if (!existsSync(reportDirectory)) {
		throw new Error(`Gate report directory is missing: ${reportDirectory}`);
	}

	const files = readdirSync(reportDirectory)
		.filter((file) => file.startsWith("gate-") && file.endsWith(".json"))
		.sort();
	if (files.length === 0) {
		throw new Error(`No gate reports found in ${reportDirectory}`);
	}

	for (const file of files) {
		const path = join(reportDirectory, file);
		try {
			reports.push(readGateReport(path));
		} catch (error) {
			throw new Error(`Failed to read report ${file}: ${error}`);
		}
	}

	return reports;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const reports = loadGateReports();

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

if (import.meta.main) {
	main().catch((e) => {
		const report = createAggregationFailureReport(e);
		writeGateReport(report, AGGREGATION_ERROR_OUTPUT);
		console.error(formatGateReport(report));
		process.exit(2);
	});
}
