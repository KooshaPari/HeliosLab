/**
 * Compliance Checker Unit Tests
 * Verifies all constitution violations are correctly detected.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import { runComplianceChecks } from "../compliance-checker";

// Fixture directory for test files
const FIXTURE_DIR = "./scripts/tests/fixtures";

describe("Compliance Checker", () => {
	beforeAll(async () => {
		// Create fixture directory
		await fs.mkdir(FIXTURE_DIR, { recursive: true });
	});

	afterAll(async () => {
		// Clean up fixtures
		try {
			await fs.rm(FIXTURE_DIR, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// Traces to: FR-GOVERNANCE-COMPLIANCE
	test("detects file size violation (>500 lines)", async () => {
		// Create a large file
		const lines = Array(501)
			.fill("// line")
			.map((l, i) => `${l} ${i}`);
		const filePath = `${FIXTURE_DIR}/large-file.ts`;
		await fs.writeFile(filePath, lines.join("\n"));

		const result = await runComplianceChecks([filePath]);

		expect(result.passed).toBe(false);
		expect(result.findings.length).toBeGreaterThan(0);
		expect(result.findings[0].check).toBe("File Size Limit");
		expect(result.findings[0].filePath).toBe(filePath);
		expect(result.findings[0].constitutionSection).toBeTruthy();
	});

	// Traces to: FR-GOVERNANCE-COMPLIANCE
	test("passes clean file under 500 lines", async () => {
		const lines = Array(100).fill("// line");
		const filePath = `${FIXTURE_DIR}/small-file.ts`;
		await fs.writeFile(filePath, lines.join("\n"));

		const result = await runComplianceChecks([filePath]);

		expect(result.passed).toBe(true);
		expect(result.findings.length).toBe(0);
	});

	// Traces to: FR-GOVERNANCE-TYPE-SAFETY
	test('detects "any" type usage', async () => {
		const content = `
export function test(value: any): void {
  console.log(value);
}`;
		const filePath = `${FIXTURE_DIR}/any-type.ts`;
		await fs.writeFile(filePath, content);

		const result = await runComplianceChecks([filePath]);

		// Type Safety findings are advisory and do not block compliance
		expect(result.passed).toBe(true);
		const anyTypeFinding = result.findings.find(
			(f) => f.check === "Type Safety",
		);
		expect(anyTypeFinding).toBeTruthy();
		expect(anyTypeFinding?.constitutionSection).toBeTruthy();
	});

	// Traces to: FR-GOVERNANCE-SECURITY
	test("detects hardcoded secrets", async () => {
		const content = `
const API_KEY = "sk-1234567890abcdef";
export const token = API_KEY;`;
		const filePath = `${FIXTURE_DIR}/secrets.ts`;
		await fs.writeFile(filePath, content);

		const result = await runComplianceChecks([filePath]);

		expect(result.passed).toBe(false);
		const securityFinding = result.findings.find((f) => f.check === "Security");
		expect(securityFinding).toBeTruthy();
		expect(securityFinding?.description).toContain("secret");
	});

	// Traces to: FR-GOVERNANCE-COMPLIANCE
	test("passes safe code without violations", async () => {
		const content = `
export function calculateSum(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0);
}`;
		const filePath = `${FIXTURE_DIR}/safe-code.ts`;
		await fs.writeFile(filePath, content);

		const result = await runComplianceChecks([filePath]);

		expect(result.passed).toBe(true);
		expect(result.findings.length).toBe(0);
	});

	test("includes remediation hints in findings", async () => {
		const lines = Array(501).fill("// line");
		const filePath = `${FIXTURE_DIR}/fixture-size.ts`;
		await fs.writeFile(filePath, lines.join("\n"));

		const result = await runComplianceChecks([filePath]);

		expect(result.findings[0].remediationHint).toBeTruthy();
		expect(result.findings[0].remediationHint.length).toBeGreaterThan(0);
	});

	test("result includes timestamp", async () => {
		const filePath = `${FIXTURE_DIR}/empty.ts`;
		await fs.writeFile(filePath, "// empty file");

		const result = await runComplianceChecks([filePath]);

		expect(result.timestamp).toBeTruthy();
		expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
	});

	test("handles multiple files", async () => {
		const file1 = `${FIXTURE_DIR}/multi-1.ts`;
		const file2 = `${FIXTURE_DIR}/multi-2.ts`;

		await fs.writeFile(file1, Array(501).fill("// line").join("\n"));
		await fs.writeFile(file2, "let x: any = 5;");

		const result = await runComplianceChecks([file1, file2]);

		expect(result.passed).toBe(false);
		expect(result.findings.length).toBeGreaterThanOrEqual(2);
	});
});
