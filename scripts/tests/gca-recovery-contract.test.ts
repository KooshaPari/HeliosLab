import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createGcaRecoveryContractReport,
	evaluateGcaRecoveryContract,
} from "../gca-recovery-contract";

const repositoryRoot = join(import.meta.dir, "..", "..");
const workflowPath = join(repositoryRoot, ".github", "workflows", "gca.yml");
const retryActionPath = join(
	repositoryRoot,
	".github",
	"actions",
	"gca-with-retry",
	"action.yml",
);

describe("GCA recovery contract (FR-REV-003)", () => {
	test("current repository exposes every unsatisfied recovery boundary", () => {
		const workflow = readFileSync(workflowPath, "utf8");
		const findings = evaluateGcaRecoveryContract(workflow, existsSync(retryActionPath));

		expect(findings.map((finding) => finding.rule)).toEqual([
			"gca-pr-trigger",
			"gca-unavailable-block",
			"gca-retry-action",
			"gca-recovery-rereview",
		]);
		expect(findings.every((finding) => finding.remediation)).toBe(true);
	});

	test("repository contract remains a structured proper red", () => {
		const workflow = readFileSync(workflowPath, "utf8");
		const report = createGcaRecoveryContractReport(workflow, existsSync(retryActionPath));

		expect(report.status).toBe("fail");
		expect(report.findings).toHaveLength(4);
	});

	test("required recovery triggers and blocking state satisfy the contract", () => {
		const compliantWorkflow = `
on:
  pull_request:
  repository_dispatch:
    types: [gca-recovered]
jobs:
  review:
    steps:
	  - run: |
	      echo status=blocked-unavailable
	      exit 1
      - run: echo gca-recovered
`;

		expect(evaluateGcaRecoveryContract(compliantWorkflow, true)).toEqual([]);
	});
});
