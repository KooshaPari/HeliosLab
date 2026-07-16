#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";

import {
	createGateReport,
	formatGateReport,
	type GateFinding,
	type GateReport,
	writeGateReport,
} from "./gate-report";

const WORKFLOW_PATH = ".github/workflows/pr-governance-gate.yml";
const CONSTITUTION_PATH = "docs/reference/constitution.md";
const REPORT_PATH = ".gate-reports/gate-constitution-reevaluation.json";

export function evaluateConstitutionReevaluationContract(workflow: string): GateFinding[] {
	const findings: GateFinding[] = [];

	const watchesAmendments =
		/^\s{2}push\s*:/m.test(workflow) && workflow.includes(CONSTITUTION_PATH);
	if (!watchesAmendments) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "Governance does not run when the constitution is amended",
			severity: "error",
			rule: "constitution-amendment-trigger",
			remediation: `Trigger governance on pushes that change ${CONSTITUTION_PATH}`,
		});
	}

	const listsOpenPullRequests =
		workflow.includes("pulls.list") || workflow.includes("gh pr list --state open");
	if (!listsOpenPullRequests) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "Constitution amendments do not enumerate open pull requests",
			severity: "error",
			rule: "constitution-open-pr-inventory",
			remediation: "List every open pull request before applying amended review requirements",
		});
	}

	const dispatchesReevaluation =
		workflow.includes("actions.createWorkflowDispatch") ||
		workflow.includes("constitution-review-reevaluation");
	if (!dispatchesReevaluation) {
		findings.push({
			file: WORKFLOW_PATH,
			message: "No review re-evaluation is dispatched for open pull requests",
			severity: "error",
			rule: "constitution-review-reevaluation",
			remediation: "Dispatch the governance review gate for each affected open pull request",
		});
	}

	return findings;
}

export function createConstitutionReevaluationReport(workflow: string): GateReport {
	return createGateReport(
		"constitution-reevaluation-contract",
		evaluateConstitutionReevaluationContract(workflow),
		0,
	);
}

function main(): void {
	const workflow = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, "utf8") : "";
	const report = createConstitutionReevaluationReport(workflow);
	writeGateReport(report, REPORT_PATH);
	process.stdout.write(`${formatGateReport(report)}\n`);
	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main();
}
