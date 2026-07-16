#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
	createGateReport,
	formatGateReport,
	type GateFinding,
	type GateReport,
	writeGateReport,
} from "./gate-report";

const PAGE_PATH = "apps/desktop/src/pages/ApprovalWorkflow.tsx";
const SOURCE_ROOT = "apps/desktop/src";
const REPORT_PATH = ".gate-reports/gate-approval-queue-ui.json";

export type ApprovalQueueUiEvidence = {
	pageSource: string;
	isRouted: boolean;
};

export function evaluateApprovalQueueUiContract(
	evidence: ApprovalQueueUiEvidence,
): GateFinding[] {
	const findings: GateFinding[] = [];

	const hasQueueSource =
		evidence.pageSource.includes("approval.queue.list") ||
		evidence.pageSource.includes("listApprovalRequests");
	if (!hasQueueSource) {
		findings.push({
			file: PAGE_PATH,
			message: "Approval queue initializes with an empty local array instead of pending requests",
			severity: "error",
			rule: "approval-queue-source",
			remediation: "Load pending requests from the runtime approval queue",
		});
	}

	const hasResolutionBoundary =
		evidence.pageSource.includes("approval.resolve") ||
		evidence.pageSource.includes("resolveApprovalRequest");
	if (!hasResolutionBoundary) {
		findings.push({
			file: PAGE_PATH,
			message: "Approve and deny controls only mutate local UI state",
			severity: "error",
			rule: "approval-resolution-boundary",
			remediation: "Send approve and deny decisions to the runtime approval service",
		});
	}

	if (!evidence.isRouted) {
		findings.push({
			file: PAGE_PATH,
			message: "ApprovalWorkflowPage is not reachable from the desktop application",
			severity: "error",
			rule: "approval-queue-route",
			remediation: "Register the approval queue page in the desktop navigation surface",
		});
	}

	return findings;
}

export function createApprovalQueueUiReport(evidence: ApprovalQueueUiEvidence): GateReport {
	return createGateReport(
		"approval-queue-ui-contract",
		evaluateApprovalQueueUiContract(evidence),
		0,
	);
}

function findSourceFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) files.push(...findSourceFiles(path));
		else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(path);
	}
	return files;
}

function main(): void {
	const pageSource = existsSync(PAGE_PATH) ? readFileSync(PAGE_PATH, "utf8") : "";
	const isRouted = findSourceFiles(SOURCE_ROOT)
		.filter((path) => relative(process.cwd(), path).replace(/\\/g, "/") !== PAGE_PATH)
		.some((path) => readFileSync(path, "utf8").includes("ApprovalWorkflowPage"));
	const report = createApprovalQueueUiReport({ pageSource, isRouted });
	writeGateReport(report, REPORT_PATH);
	process.stdout.write(`${formatGateReport(report)}\n`);
	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main();
}
