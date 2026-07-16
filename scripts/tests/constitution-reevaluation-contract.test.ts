import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createConstitutionReevaluationReport,
	evaluateConstitutionReevaluationContract,
} from "../constitution-reevaluation-contract";

const workflowPath = join(
	import.meta.dir,
	"..",
	"..",
	".github",
	"workflows",
	"pr-governance-gate.yml",
);

describe("constitution review re-evaluation contract (FR-REV-010)", () => {
	test("current repository exposes each missing re-evaluation boundary", () => {
		const workflow = readFileSync(workflowPath, "utf8");
		const findings = evaluateConstitutionReevaluationContract(workflow);

		expect(findings.map((finding) => finding.rule)).toEqual([
			"constitution-amendment-trigger",
			"constitution-open-pr-inventory",
			"constitution-review-reevaluation",
		]);
		expect(findings.every((finding) => finding.remediation)).toBe(true);
	});

	test("repository contract remains a structured proper red", () => {
		const workflow = readFileSync(workflowPath, "utf8");
		const report = createConstitutionReevaluationReport(workflow);

		expect(report.status).toBe("fail");
		expect(report.findings).toHaveLength(3);
	});

	test("amendment inventory and dispatch satisfy the executable contract", () => {
		const compliantWorkflow = `
on:
  push:
    paths:
      - docs/reference/constitution.md
steps:
  - run: gh pr list --state open
  - uses: actions/github-script
    with:
      script: actions.createWorkflowDispatch({ event_type: "constitution-review-reevaluation" })
`;

		expect(evaluateConstitutionReevaluationContract(compliantWorkflow)).toEqual([]);
	});
});
