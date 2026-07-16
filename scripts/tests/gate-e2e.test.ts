import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { evaluateE2EResult } from "../gate-e2e";

describe("E2E quality gate", () => {
	test("missing execution evidence fails closed (FR-CI-011)", () => {
		const findings = evaluateE2EResult({ evidenceFound: false, exitCode: 0, output: "" });

		expect(findings).toEqual([
			expect.objectContaining({
				rule: "e2e-evidence-missing",
				severity: "error",
				remediation: expect.any(String),
			}),
		]);
	});

	test("non-zero Playwright exit fails even without a failure keyword", () => {
		const findings = evaluateE2EResult({
			evidenceFound: true,
			exitCode: 2,
			output: "Playwright exited unexpectedly",
		});

		expect(findings).toEqual([
			expect.objectContaining({ rule: "e2e-exit", severity: "error" }),
		]);
	});

	test("successful Playwright evidence remains green", () => {
		expect(
			evaluateE2EResult({ evidenceFound: true, exitCode: 0, output: "12 passed" }),
		).toEqual([]);
	});

	test("workflow preserves Playwright and report-generator exits", () => {
		const workflow = readFileSync(
			join(import.meta.dir, "..", "..", ".github", "workflows", "quality-gates.yml"),
			"utf8",
		);

		expect(workflow).toContain("bun run test:e2e | tee /tmp/e2e.log");
		expect(workflow).toContain("E2E_EXIT=${PIPESTATUS[0]}");
		expect(workflow).toContain("bun run scripts/gate-e2e.ts");
		expect(workflow).toContain('if [ "$E2E_EXIT" -ne 0 ] || [ "$REPORT_EXIT" -ne 0 ]; then');
	});
});
