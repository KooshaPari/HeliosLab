import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createApprovalQueueUiReport,
	evaluateApprovalQueueUiContract,
} from "../approval-queue-ui-contract";

const pagePath = join(
	import.meta.dir,
	"..",
	"..",
	"apps",
	"desktop",
	"src",
	"pages",
	"ApprovalWorkflow.tsx",
);

describe("approval queue UI contract (FR-APR-009)", () => {
	test("current page exposes each missing integration boundary", () => {
		const pageSource = readFileSync(pagePath, "utf8");
		const findings = evaluateApprovalQueueUiContract({ pageSource, isRouted: false });

		expect(findings.map((finding) => finding.rule)).toEqual([
			"approval-queue-source",
			"approval-resolution-boundary",
			"approval-queue-route",
		]);
		expect(findings.every((finding) => finding.remediation)).toBe(true);
	});

	test("repository contract remains a structured proper red", () => {
		const pageSource = readFileSync(pagePath, "utf8");
		const report = createApprovalQueueUiReport({ pageSource, isRouted: false });

		expect(report.status).toBe("fail");
		expect(report.findings).toHaveLength(3);
	});

	test("queue source, resolution boundary, and route satisfy the contract", () => {
		const integratedPage = `
await runtime.request("approval.queue.list");
await runtime.request("approval.resolve");
`;

		expect(
			evaluateApprovalQueueUiContract({ pageSource: integratedPage, isRouted: true }),
		).toEqual([]);
	});
});
