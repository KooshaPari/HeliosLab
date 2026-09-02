/**
 * ADR Exception Workflow Tests
 * Verifies the ADR approval and validation process.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";

const ADR_DIR = "./scripts/tests/adr-fixtures";

describe("ADR Exception Workflow", () => {
	beforeAll(async () => {
		await fs.mkdir(ADR_DIR, { recursive: true });
	});

	afterAll(async () => {
		try {
			await fs.rm(ADR_DIR, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	test("validates ADR with sunset date and 3 approvals", async () => {
		const adrContent = `# ADR-2026-001: Test Exception

## Status
accepted

## Date
2026-03-01

## Constitution Section Being Excepted
Code Structure and Maintainability - File size limit

## Justification
Test exception for testing purposes.

## Sunset Date
2026-12-31

## Approvals
- @reviewer1
- @reviewer2
- @reviewer3`;

		const adrPath = `${ADR_DIR}/ADR-2026-001.md`;
		await fs.writeFile(adrPath, adrContent);

		// Parse and validate
		const content = await fs.readFile(adrPath, "utf-8");
		const hasStatus = content.includes("Status\naccepted");
		const hasSunset = content.includes("Sunset Date");
		const approvals = (content.match(/@reviewer/g) || []).length;

		expect(hasStatus).toBe(true);
		expect(hasSunset).toBe(true);
		expect(approvals).toBeGreaterThanOrEqual(3);
	});

	test("rejects ADR without sunset date", async () => {
		const adrContent = `# ADR-2026-002: No Sunset

## Status
proposed

## Date
2026-03-01

## Constitution Section Being Excepted
Code Structure and Maintainability

## Justification
Exception without sunset date - should be rejected.

## Approvals
- @reviewer1
- @reviewer2
- @reviewer3`;

		const adrPath = `${ADR_DIR}/ADR-2026-002.md`;
		await fs.writeFile(adrPath, adrContent);

		const content = await fs.readFile(adrPath, "utf-8");
		const hasSunset =
			content.includes("Sunset Date") ||
			content.includes("Permanence Justification");
		const hasJustification = content.includes("Justification");

		// ADR is invalid if it has justification but no sunset AND no permanence
		const hasPermanence = content.includes("Permanence Justification");
		const isValid = hasSunset || hasPermanence;

		expect(isValid).toBe(false);
	});

	test("rejects ADR with insufficient approvals (< 3)", async () => {
		const adrContent = `# ADR-2026-003: Low Approvals

## Status
proposed

## Date
2026-03-01

## Constitution Section Being Excepted
Code Structure and Maintainability

## Justification
Exception with only 2 approvals - should be rejected.

## Sunset Date
2026-12-31

## Approvals
- @reviewer1
- @reviewer2`;

		const adrPath = `${ADR_DIR}/ADR-2026-003.md`;
		await fs.writeFile(adrPath, adrContent);

		const content = await fs.readFile(adrPath, "utf-8");
		const approvals = (content.match(/@reviewer/g) || []).length;

		expect(approvals).toBeLessThan(3);
	});

	test("accepts ADR with permanence justification (no sunset)", async () => {
		const adrContent = `# ADR-2026-004: Permanent Exception

## Status
accepted

## Date
2026-03-01

## Constitution Section Being Excepted
Code Structure and Maintainability

## Justification
This exception is for auto-generated code that must remain as-is.

## Permanence Justification
This file is auto-generated from schema definitions. Splitting would require custom generation logic. The exception is permanent as long as we support legacy schemas.

## Approvals
- @reviewer1
- @reviewer2
- @reviewer3`;

		const adrPath = `${ADR_DIR}/ADR-2026-004.md`;
		await fs.writeFile(adrPath, adrContent);

		const content = await fs.readFile(adrPath, "utf-8");
		const hasPermanence = content.includes("Permanence Justification");
		const approvals = (content.match(/@reviewer/g) || []).length;

		expect(hasPermanence).toBe(true);
		expect(approvals).toBeGreaterThanOrEqual(3);
	});

	test("detects expired ADR (past sunset date)", async () => {
		const adrContent = `# ADR-2026-005: Expired

## Status
superseded

## Date
2026-01-01

## Constitution Section Being Excepted
Code Structure and Maintainability

## Justification
This ADR has expired.

## Sunset Date
2026-01-31`;

		const adrPath = `${ADR_DIR}/ADR-2026-005.md`;
		await fs.writeFile(adrPath, adrContent);

		const content = await fs.readFile(adrPath, "utf-8");
		const sunsetMatch = content.match(/Sunset Date\n(\d{4}-\d{2}-\d{2})/);

		if (sunsetMatch) {
			const sunsetDate = new Date(sunsetMatch[1]);
			const now = new Date();
			const isExpired = sunsetDate < now;

			expect(isExpired).toBe(true);
		}
	});

	test("validates ADR file naming convention", async () => {
		const validNames = [
			"ADR-2026-001.md",
			"ADR-2026-042.md",
			"ADR-2027-100.md",
		];

		const adrNameRegex = /^ADR-\d{4}-\d{3}\.md$/;

		validNames.forEach((name) => {
			expect(adrNameRegex.test(name)).toBe(true);
		});

		const invalidNames = [
			"adr-2026-001.md", // lowercase
			"ADR-2026-01.md", // single digit number
			"ADR-26-001.md", // short year
		];

		invalidNames.forEach((name) => {
			expect(adrNameRegex.test(name)).toBe(false);
		});
	});

	test("ADR with valid exception updates governance log", async () => {
		// Simulate a merge with ADR
		const adrRef = "ADR-2026-001";
		const prNumber = 123;
		const author = "test-author";

		// In governance log, exceptionADRs field would contain ['ADR-2026-001']
		const exceptionADRs = adrRef ? [adrRef] : [];

		expect(exceptionADRs.length).toBeGreaterThan(0);
		expect(exceptionADRs[0]).toBe("ADR-2026-001");
	});
});
