/**
 * Compliance Checker Unit Tests
 * Verifies all constitution violations are correctly detected.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
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

	// Traces to: FR-GOVERNANCE-COMPLIANCE
	//
	// Spawned helper entry points (e.g. a subprocess script that a test
	// file drives via Bun.spawn) live under __tests__/ but are not test
	// files themselves, so the ".test." skip misses them. Requiring a
	// paired test for such a file produces a circular, unsatisfiable
	// demand. The check must skip the whole __tests__/ tree, matching the
	// skip checkUnsafePatterns() already applies.
	test("does not demand a paired test for __tests__ helper entry points", async () => {
		const helperDir = "apps/runtime/src/__tests__/helpers";
		const filePath = `${helperDir}/probe-helper.ts`;
		await fs.mkdir(helperDir, { recursive: true });
		await fs.writeFile(filePath, "export const noop = () => {};\n");

		try {
			const result = await runComplianceChecks([filePath]);
			const coverageFindings = result.findings.filter(
				(f) => f.check === "Test Coverage" && f.filePath === filePath,
			);
			expect(coverageFindings).toEqual([]);
		} finally {
			// Only remove the probe if it is still ours; the directory may
			// hold real helpers in the repository.
			await fs.rm(filePath, { force: true }).catch(() => {});
			await fs.rmdir(helperDir).catch(() => {});
		}
	});

	// Traces to: FR-GOVERNANCE-COMPLIANCE
	//
	// Guard against over-broadening the skip above: a real source file
	// outside any test tree must still be required to have a test.
	test("still demands a paired test for ordinary source files", async () => {
		const filePath = "apps/runtime/src/__probe_untested_source.ts";
		await fs.writeFile(filePath, "export const noop = () => {};\n");

		try {
			const result = await runComplianceChecks([filePath]);
			const coverageFindings = result.findings.filter(
				(f) => f.check === "Test Coverage" && f.filePath === filePath,
			);
			expect(coverageFindings.length).toBe(1);
			expect(coverageFindings[0].description).toBe(
				"No corresponding test file found",
			);
		} finally {
			await fs.rm(filePath, { force: true }).catch(() => {});
		}
	});
});
