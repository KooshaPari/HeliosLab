import { expect, test, describe } from "bun:test";
import {
	createGateReport,
	aggregateGateReports,
	formatGateReport,
	formatPipelineSummary,
	type GateFinding,
	type GateReport,
} from "../gate-report";

describe("Gate Report Generator", () => {
	// Traces to: FR-GOVERNANCE-GATES
	test("create pass report with no findings", () => {
		const report = createGateReport("typecheck", [], 100);

		expect(report.gateName).toBe("typecheck");
		expect(report.status).toBe("pass");
		expect(report.findings.length).toBe(0);
		expect(report.duration).toBe(100);
		expect(report.summary?.errors).toBe(0);
	});

	// Traces to: FR-GOVERNANCE-GATES
	test("create fail report with error findings", () => {
		const findings: GateFinding[] = [
			{
				file: "app.ts",
				line: 10,
				column: 5,
				message: "Type error",
				severity: "error",
				rule: "TS7006",
			},
		];

		const report = createGateReport("typecheck", findings, 200);

		expect(report.gateName).toBe("typecheck");
		expect(report.status).toBe("fail");
		expect(report.findings.length).toBe(1);
		expect(report.summary?.errors).toBe(1);
	});

	// Traces to: FR-GOVERNANCE-GATES
	test("count findings by severity", () => {
		const findings: GateFinding[] = [
			{
				file: "app.ts",
				line: 1,
				message: "Error 1",
				severity: "error",
			},
			{
				file: "app.ts",
				line: 2,
				message: "Error 2",
				severity: "error",
			},
			{
				file: "app.ts",
				line: 3,
				message: "Warning 1",
				severity: "warning",
			},
			{
				file: "app.ts",
				line: 4,
				message: "Info 1",
				severity: "info",
			},
		];

		const report = createGateReport("lint", findings, 150);

		expect(report.summary?.errors).toBe(2);
		expect(report.summary?.warnings).toBe(1);
		expect(report.summary?.infos).toBe(1);
	});

	// Traces to: FR-GOVERNANCE-GATES
	test("aggregate gate reports into pipeline summary", () => {
		const report1 = createGateReport("typecheck", [], 100);
		const report2 = createGateReport("lint", [], 150);
		const report3: GateReport = {
			gateName: "test",
			status: "fail",
			findings: [
				{
					file: "test.ts",
					message: "Test failed",
					severity: "error",
				},
			],
			duration: 200,
			timestamp: new Date().toISOString(),
			summary: { errors: 1, warnings: 0, infos: 0 },
		};

		const summary = aggregateGateReports([report1, report2, report3]);

		expect(summary.gates.length).toBe(3);
		expect(summary.status).toBe("fail");
		expect(summary.failedGates).toEqual(["test"]);
		expect(summary.totalDuration).toBe(450);
	});

	// Traces to: FR-GOVERNANCE-GATES
	test("pipeline summary passes when all gates pass", () => {
		const report1 = createGateReport("typecheck", [], 100);
		const report2 = createGateReport("lint", [], 150);

		const summary = aggregateGateReports([report1, report2]);

		expect(summary.status).toBe("pass");
		expect(summary.failedGates.length).toBe(0);
	});

	// Traces to: FR-GOVERNANCE-AUDIT
	test("gate report includes timestamp", () => {
		const report = createGateReport("typecheck", [], 100);
		expect(report.timestamp).toBeDefined();
		expect(new Date(report.timestamp).getTime()).toBeGreaterThan(0);
	});

	test("format gate report for display", () => {
		const findings: GateFinding[] = [
			{
				file: "app.ts",
				line: 10,
				column: 5,
				message: "Type error",
				severity: "error",
				rule: "TS7006",
			},
		];

		const report = createGateReport("typecheck", findings, 100);
		const formatted = formatGateReport(report);

		expect(formatted).toContain("Gate: typecheck");
		expect(formatted).toContain("Status: FAIL");
		expect(formatted).toContain("app.ts:10");
		expect(formatted).toContain("Type error");
	});

	test("format pipeline summary for display", () => {
		const report1 = createGateReport("typecheck", [], 100);
		const report2: GateReport = {
			gateName: "lint",
			status: "fail",
			findings: [],
			duration: 150,
			timestamp: new Date().toISOString(),
			summary: { errors: 1, warnings: 0, infos: 0 },
		};

		const summary = aggregateGateReports([report1, report2]);
		const formatted = formatPipelineSummary(summary);

		expect(formatted).toContain("QUALITY GATES SUMMARY");
		expect(formatted).toContain("Status: FAIL");
		expect(formatted).toContain("Gates Executed: 2");
		expect(formatted).toContain("Failed Gates:");
	});

	test("gate finding with all optional fields", () => {
		const finding: GateFinding = {
			file: "src/app.ts",
			line: 42,
			column: 15,
			message: "Complex error",
			severity: "error",
			rule: "custom-rule",
			remediation: "Fix by doing X",
		};

		expect(finding.file).toBe("src/app.ts");
		expect(finding.line).toBe(42);
		expect(finding.column).toBe(15);
		expect(finding.rule).toBe("custom-rule");
		expect(finding.remediation).toBe("Fix by doing X");
	});

	test("gate finding without optional fields", () => {
		const finding: GateFinding = {
			file: "src/app.ts",
			message: "Simple error",
			severity: "error",
		};

		expect(finding.file).toBe("src/app.ts");
		expect(finding.line).toBeUndefined();
		expect(finding.column).toBeUndefined();
		expect(finding.rule).toBeUndefined();
	});

	test("multiple gate reports with mixed pass/fail", () => {
		const reports: GateReport[] = [
			createGateReport("typecheck", [], 100),
			createGateReport("lint", [], 150),
			{
				gateName: "test",
				status: "fail",
				findings: [{ file: "test.ts", message: "Failed", severity: "error" }],
				duration: 200,
				timestamp: new Date().toISOString(),
				summary: { errors: 1, warnings: 0, infos: 0 },
			},
			createGateReport("e2e", [], 300),
		];

		const summary = aggregateGateReports(reports);

		expect(summary.gates.length).toBe(4);
		expect(summary.status).toBe("fail");
		expect(summary.failedGates).toEqual(["test"]);
		expect(summary.totalDuration).toBe(750);
	});
});
