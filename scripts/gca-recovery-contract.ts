#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";

import {
	createGateReport,
	formatGateReport,
	type GateFinding,
	type GateReport,
	writeGateReport,
} from "./gate-report";

const WORKFLOW_PATH = ".github/workflows/gca.yml";
const RETRY_ACTION_PATH = ".github/actions/gca-with-retry/action.yml";
const REPORT_PATH = ".gate-reports/gate-gca-recovery.json";

export function evaluateGcaRecoveryContract(
	workflow: string,
	retryActionExists: boolean,
): GateFinding[] {
	const findings: GateFinding[] = [];

	if (!/^\s{2}pull_request\s*:/m.test(workflow)) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "GCA review is not automatically triggered for pull requests",
			severity: "error",
			rule: "gca-pr-trigger",
			remediation: "Enable the pull_request trigger after the external reviewer is configured",
		});
	}

	const blocksUnavailableReview =
		workflow.includes("status=blocked-unavailable") && workflow.includes("exit 1");
	if (!blocksUnavailableReview) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "Unavailable GCA credentials are treated as a successful skip",
			severity: "error",
			rule: "gca-unavailable-block",
			remediation: "Emit a failing required check whenever GCA is unavailable",
		});
	}

	if (!retryActionExists) {
		findings.push({
			file: RETRY_ACTION_PATH,
			message: "The referenced GCA retry action is missing",
			severity: "error",
			rule: "gca-retry-action",
			remediation: "Provide and test the local retry action used by the GCA workflow",
		});
	}

	const hasRecoveryDispatch =
		workflow.includes("actions.createWorkflowDispatch") ||
		(workflow.includes("repository_dispatch") && workflow.includes("gca-recovered"));
	if (!hasRecoveryDispatch) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "No automation requests a new review after GCA service recovery",
			severity: "error",
			rule: "gca-recovery-rereview",
			remediation: "Dispatch a fresh GCA review when service recovery is detected",
		});
	}

	return findings;
}

export function createGcaRecoveryContractReport(
	workflow: string,
	retryActionExists: boolean,
): GateReport {
	return createGateReport(
		"gca-recovery-contract",
		evaluateGcaRecoveryContract(workflow, retryActionExists),
		0,
	);
}

function main(): void {
	const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, "utf8") : "";
	const report = createGcaRecoveryContractReport(workflow, existsSync(RETRY_ACTION_PATH));
	writeGateReport(report, REPORT_PATH);
	process.stdout.write(`${formatGateReport(report)}\n`);
	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main();
}
