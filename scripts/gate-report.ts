/**
 * Structured gate report generation utilities.
 * All quality gates produce JSON reports conforming to this schema.
 */

/**
 * Represents a single finding (error, warning, or info) from a gate.
 */
export interface GateFinding {
	/** File path relative to repo root */
	file: string;
	/** Line number (1-indexed), optional for aggregate findings */
	line?: number;
	/** Column number (0-indexed), optional */
	column?: number;
	/** Human-readable message describing the issue */
	message: string;
	/** Severity level: error (fail gate) | warning | info */
	severity: "error" | "warning" | "info";
	/** Rule name or check identifier (e.g., 'no-unused-vars', 'TS6133') */
	rule?: string;
	/** Optional remediation hint */
	remediation?: string;
}

/**
 * Represents a complete quality gate report.
 */
export interface GateReport {
	/** Unique identifier for the gate (e.g., 'typecheck', 'lint') */
	gateName: string;
	/** Overall gate status */
	status: "pass" | "fail";
	/** Array of findings, empty if status is pass */
	findings: GateFinding[];
	/** Execution duration in milliseconds */
	duration: number;
	/** ISO 8601 timestamp when the gate was executed */
	timestamp: string;
	/** Optional: number of files scanned */
	filesScanned?: number;
	/** Optional: total count of issues by severity */
	summary?: {
		errors: number;
		warnings: number;
		infos: number;
	};
}

/**
 * Represents an aggregated pipeline summary.
 */
export interface PipelineSummary {
	/** Timestamp when the pipeline started */
	timestamp: string;
	/** All gate reports in execution order */
	gates: GateReport[];
	/** Overall pipeline status: pass (all gates pass) | fail (any gate fails) */
	status: "pass" | "fail";
	/** Total pipeline duration in milliseconds */
	totalDuration: number;
	/** List of gate names that failed, empty if all passed */
	failedGates: string[];
}

/**
 * Create a gate report with the given parameters.
 */
export function createGateReport(
	gateName: string,
	findings: GateFinding[],
	durationMs: number,
): GateReport {
	const errors = findings.filter((f) => f.severity === "error").length;
	const warnings = findings.filter((f) => f.severity === "warning").length;
	const infos = findings.filter((f) => f.severity === "info").length;

	return {
		gateName,
		status: errors > 0 ? "fail" : "pass",
		findings,
		duration: durationMs,
		timestamp: new Date().toISOString(),
		summary: {
			errors,
			warnings,
			infos,
		},
	};
}

/**
 * Write a gate report to disk as JSON.
 */
export function writeGateReport(report: GateReport, outputPath: string): void {
	const fs = require("fs");
	const dir = require("path").dirname(outputPath);

	// Ensure directory exists
	fs.mkdirSync(dir, { recursive: true });

	// Write report as formatted JSON
	fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

/**
 * Aggregate multiple gate reports into a pipeline summary.
 */
export function aggregateGateReports(reports: GateReport[]): PipelineSummary {
	const failedGates = reports
		.filter((r) => r.status === "fail")
		.map((r) => r.gateName);
	const totalDuration = reports.reduce((sum, r) => sum + r.duration, 0);

	return {
		timestamp: new Date().toISOString(),
		gates: reports,
		status: failedGates.length > 0 ? "fail" : "pass",
		totalDuration,
		failedGates,
	};
}

/**
 * Read a gate report from disk.
 */
export function readGateReport(filePath: string): GateReport {
	const fs = require("fs");
	const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	return data as GateReport;
}

/**
 * Pretty-print a gate report for human consumption.
 */
export function formatGateReport(report: GateReport): string {
	const lines: string[] = [];

	lines.push(`\nGate: ${report.gateName}`);
	lines.push(`Status: ${report.status.toUpperCase()}`);
	lines.push(`Duration: ${report.duration}ms`);
	lines.push(`Timestamp: ${report.timestamp}`);

	if (report.summary) {
		lines.push(
			`Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos`,
		);
	}

	if (report.findings.length > 0) {
		lines.push("\nFindings:");
		report.findings.forEach((finding, i) => {
			const location = finding.line
				? `${finding.file}:${finding.line}${finding.column ? `:${finding.column}` : ""}`
				: finding.file;
			lines.push(`  ${i + 1}. [${finding.severity.toUpperCase()}] ${location}`);
			lines.push(`     ${finding.message}`);
			if (finding.rule) {
				lines.push(`     Rule: ${finding.rule}`);
			}
			if (finding.remediation) {
				lines.push(`     Fix: ${finding.remediation}`);
			}
		});
	} else if (report.status === "pass") {
		lines.push("No findings.");
	}

	return lines.join("\n");
}

/**
 * Pretty-print a pipeline summary.
 */
export function formatPipelineSummary(summary: PipelineSummary): string {
	const lines: string[] = [];

	lines.push("\n========== QUALITY GATES SUMMARY ==========");
	lines.push(`Overall Status: ${summary.status.toUpperCase()}`);
	lines.push(`Total Duration: ${summary.totalDuration}ms`);
	lines.push(`Timestamp: ${summary.timestamp}`);

	lines.push(`\nGates Executed: ${summary.gates.length}`);
	summary.gates.forEach((gate) => {
		const statusIcon = gate.status === "pass" ? "✓" : "✗";
		const summary_str = gate.summary ? `(${gate.summary.errors} errors)` : "";
		lines.push(
			`  ${statusIcon} ${gate.gateName} - ${gate.status} ${summary_str}`,
		);
	});

	if (summary.failedGates.length > 0) {
		lines.push(`\nFailed Gates: ${summary.failedGates.join(", ")}`);
	}

	lines.push("==========================================\n");

	return lines.join("\n");
}
