import { expect, test, describe } from "bun:test";
import { createGateReport, type GateFinding } from "../gate-report";

describe("Gate Integration Tests", () => {
	// Traces to: FR-CI-001, FR-CI-006
	// Coverage Gate Tests
	describe("Coverage Gate", () => {
		// Traces to: FR-CI-006
		test("coverage below threshold fails gate", () => {
			const findings: GateFinding[] = [
				{
					file: "runtime",
					message: "Coverage for lines is 78%, below threshold of 85%",
					severity: "error",
					rule: "coverage-lines",
				},
			];

			const report = createGateReport("coverage", findings, 1000);

			expect(report.status).toBe("fail");
			expect(report.findings.length).toBe(1);
			expect(report.findings[0].file).toBe("runtime");
		});

		test("coverage above threshold passes gate", () => {
			const findings: GateFinding[] = [];
			const report = createGateReport("coverage", findings, 1000);

			expect(report.status).toBe("pass");
			expect(report.findings.length).toBe(0);
		});

		test("zero coverage detected as violation", () => {
			const findings: GateFinding[] = [
				{
					file: "new-package",
					message: "Coverage for lines is 0%, below threshold of 85%",
					severity: "error",
					rule: "coverage-lines",
				},
			];

			const report = createGateReport("coverage", findings, 500);

			expect(report.status).toBe("fail");
			expect(report.summary?.errors).toBeGreaterThan(0);
		});

		test("multiple package violations reported", () => {
			const findings: GateFinding[] = [
				{
					file: "runtime",
					message: "Coverage for branches is 80%, below threshold of 85%",
					severity: "error",
					rule: "coverage-branches",
				},
				{
					file: "desktop",
					message: "Coverage for functions is 75%, below threshold of 85%",
					severity: "error",
					rule: "coverage-functions",
				},
			];

			const report = createGateReport("coverage", findings, 1000);

			expect(report.status).toBe("fail");
			expect(report.findings.length).toBe(2);
		});
	});

	// Traces to: FR-CI-002, FR-CI-003, FR-CI-007 (type check, lint, security)
	// Security Gate Tests
	describe("Security Gate", () => {
		// Traces to: FR-CI-007 (security scanning)
		test("high severity vulnerability fails gate", () => {
			const findings: GateFinding[] = [
				{
					file: "lodash",
					message: "[HIGH] CVE-2021-23337: Lodash vulnerability",
					severity: "error",
					rule: "security-vulnerability",
					remediation: "Upgrade to lodash@4.17.21 or higher",
				},
			];

			const report = createGateReport("security", findings, 2000);

			expect(report.status).toBe("fail");
			expect(report.findings[0].severity).toBe("error");
		});

		test("critical severity vulnerability fails gate", () => {
			const findings: GateFinding[] = [
				{
					file: "express",
					message: "[CRITICAL] CVE-2022-XXXXX: Critical vulnerability",
					severity: "error",
					rule: "security-vulnerability",
					remediation: "Immediate upgrade required",
				},
			];

			const report = createGateReport("security", findings, 2000);

			expect(report.status).toBe("fail");
		});

		test("no vulnerabilities passes gate", () => {
			const findings: GateFinding[] = [];
			const report = createGateReport("security", findings, 2000);

			expect(report.status).toBe("pass");
		});

		test("medium severity vulnerability reported as warning", () => {
			const findings: GateFinding[] = [
				{
					file: "package-name",
					message: "[MEDIUM] Some vulnerability",
					severity: "warning",
					rule: "security-advisory",
				},
			];

			const report = createGateReport("security", findings, 1500);

			// Only errors fail the gate, warnings don't
			expect(report.status).toBe("pass");
			expect(report.findings.length).toBe(1);
		});
	});

	// Traces to: FR-CI-008 (static analysis)
	// Static Analysis Gate Tests
	describe("Static Analysis Gate", () => {
		// Traces to: FR-CI-008
		test("file exceeding length limit fails gate", () => {
			const findings: GateFinding[] = [
				{
					file: "apps/desktop/src/main.ts",
					line: 1,
					message: "File has 650 lines, exceeds maximum of 500",
					severity: "error",
					rule: "file-length",
					remediation: "Break file into smaller modules",
				},
			];

			const report = createGateReport("static-analysis", findings, 1500);

			expect(report.status).toBe("fail");
			expect(report.findings[0].rule).toBe("file-length");
		});

		test("excessive cyclomatic complexity detected", () => {
			const findings: GateFinding[] = [
				{
					file: "apps/desktop/src/utils.ts",
					line: 42,
					message: "Cyclomatic complexity is 20, exceeds maximum of 15",
					severity: "error",
					rule: "cyclomatic-complexity",
					remediation: "Refactor function to reduce complexity",
				},
			];

			const report = createGateReport("static-analysis", findings, 1200);

			expect(report.status).toBe("fail");
		});

		test("unused variable detected", () => {
			const findings: GateFinding[] = [
				{
					file: "apps/runtime/src/lib.ts",
					line: 15,
					message: "Unused variable: oldValue",
					severity: "warning",
					rule: "unused-variable",
				},
			];

			const report = createGateReport("static-analysis", findings, 1000);

			// Warning doesn't fail the gate
			expect(report.status).toBe("pass");
			expect(report.summary?.warnings).toBe(1);
		});

		test("clean code passes gate", () => {
			const findings: GateFinding[] = [];
			const report = createGateReport("static-analysis", findings, 800);

			expect(report.status).toBe("pass");
		});

		test("multiple violations reported", () => {
			const findings: GateFinding[] = [
				{
					file: "app1.ts",
					line: 1,
					message: "File has 600 lines, exceeds maximum of 500",
					severity: "error",
					rule: "file-length",
				},
				{
					file: "app2.ts",
					line: 50,
					message: "Cyclomatic complexity is 18, exceeds maximum of 15",
					severity: "error",
					rule: "cyclomatic-complexity",
				},
			];

			const report = createGateReport("static-analysis", findings, 1500);

			expect(report.status).toBe("fail");
			expect(report.summary?.errors).toBe(2);
		});
	});

	// Traces to: FR-REV-005, FR-REV-008 (compliance checking and governance logging)
	// General Gate Report Tests
	describe("Gate Report Schema Validation", () => {
		test("all gate reports have required fields", () => {
			// Traces to: FR-REV-008 (record merge with gate results)
			const findings: GateFinding[] = [];
			const report = createGateReport("coverage", findings, 100);

			expect(report.gateName).toBeDefined();
			expect(report.status).toBeDefined();
			expect(report.findings).toBeDefined();
			expect(report.duration).toBeDefined();
			expect(report.timestamp).toBeDefined();
		});

		test("gate report duration is accurate", () => {
			const duration = 12345;
			const report = createGateReport("test", [], duration);

			expect(report.duration).toBe(duration);
		});

		test("gate finding has all optional fields", () => {
			const findings: GateFinding[] = [
				{
					file: "app.ts",
					line: 10,
					column: 5,
					message: "Error",
					severity: "error",
					rule: "rule-name",
					remediation: "Fix this",
				},
			];

			const report = createGateReport("test", findings, 100);

			expect(report.findings[0].file).toBe("app.ts");
			expect(report.findings[0].line).toBe(10);
			expect(report.findings[0].column).toBe(5);
			expect(report.findings[0].rule).toBe("rule-name");
			expect(report.findings[0].remediation).toBe("Fix this");
		});

		test("summary counts findings correctly", () => {
			const findings: GateFinding[] = [
				{ file: "a", message: "E1", severity: "error" },
				{ file: "b", message: "E2", severity: "error" },
				{ file: "c", message: "W1", severity: "warning" },
			];

			const report = createGateReport("test", findings, 100);

			expect(report.summary?.errors).toBe(2);
			expect(report.summary?.warnings).toBe(1);
			expect(report.summary?.infos).toBe(0);
		});
	});
});
