import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createConstitutionReevaluationReport,
	evaluateConstitutionReevaluationContract,
} from "../constitution-reevaluation-contract";

type Pull = { number: number; head: { sha: string } };
type Dispatch = {
	event_type: string;
	client_payload: { pr_number: string; head_sha: string; constitution_sha: string };
};
type ReevaluationInput = {
	github: {
		rest: {
			pulls: { list(input: { page: number }): Promise<{ data: Pull[] }> };
			repos: { createDispatchEvent(input: Dispatch): Promise<void> };
		};
	};
	context: { repo: { owner: string; repo: string }; sha: string };
};

const reevaluateOpenPullRequests = require(
	"../../.github/scripts/reevaluate-open-prs.cjs",
) as (input: ReevaluationInput) => Promise<number>;

const workflowPath = join(
	import.meta.dir,
	"..",
	"..",
	".github",
	"workflows",
	"pr-governance-gate.yml",
);

describe("constitution review re-evaluation contract (FR-REV-010)", () => {
	test("governance re-evaluates every open PR after a constitution amendment", () => {
		const workflow = readFileSync(workflowPath, "utf8");

		expect(evaluateConstitutionReevaluationContract(workflow)).toEqual([]);
		expect(workflow).toContain("reevaluate-open-prs.cjs");
		expect(workflow).toContain("types: [constitution-review-reevaluation]");
		expect(workflow).toContain("ref: ${{ github.sha }}");
		expect(workflow).toContain("persist-credentials: false");
		expect(workflow).toContain("pull.state !== \"open\"");
		expect(workflow).toContain("pull.head.sha !== requestedHead");
		const inventoryJob = workflow.split("  constitution-open-pr-inventory:")[1]?.split(
			"  pr-governance-gate:",
		)[0] ?? "";
		expect(inventoryJob).toContain("contents: write");
		expect(inventoryJob).toContain("pull-requests: read");
		const canonicalJob = workflow.split("  pr-governance-gate:")[1] ?? "";
		expect(canonicalJob).toContain("contents: read");
		expect(canonicalJob).toContain("pull-requests: read");
		expect(canonicalJob).not.toContain("contents: write");
		expect(canonicalJob).not.toContain("actions/checkout");
		expect(canonicalJob).toContain(
			'run: |\n          echo "Governance check entered for PR #${{ steps.target.outputs.pr_number }} at ${{ steps.target.outputs.head_sha }}"',
		);
	});

	test("inventory traverses multiple pages and binds every dispatch", async () => {
		const pages: number[] = [];
		const dispatches: Dispatch[] = [];
		const firstPage = Array.from({ length: 100 }, (_, index) => ({
			number: index + 1,
			head: { sha: `head-${index + 1}` },
		}));
		const count = await reevaluateOpenPullRequests({
			github: {
				rest: {
					pulls: {
						list: async ({ page }) => {
							pages.push(page);
							return { data: page === 1 ? firstPage : [{ number: 101, head: { sha: "head-101" } }] };
						},
					},
					repos: {
						createDispatchEvent: async (input) => {
							dispatches.push(input);
						},
					},
				},
			},
			context: { repo: { owner: "helios", repo: "lab" }, sha: "constitution-head" },
		});

		expect(pages).toEqual([1, 2]);
		expect(count).toBe(101);
		expect(dispatches).toHaveLength(101);
		expect(dispatches[100]).toMatchObject({
			event_type: "constitution-review-reevaluation",
			client_payload: {
				pr_number: "101",
				head_sha: "head-101",
				constitution_sha: "constitution-head",
			},
		});
	});

	test("zero open PRs succeeds without dispatching", async () => {
		let dispatchCount = 0;
		const count = await reevaluateOpenPullRequests({
			github: {
				rest: {
					pulls: { list: async () => ({ data: [] }) },
					repos: {
						createDispatchEvent: async () => {
							dispatchCount += 1;
						},
					},
				},
			},
			context: { repo: { owner: "helios", repo: "lab" }, sha: "constitution-head" },
		});

		expect(count).toBe(0);
		expect(dispatchCount).toBe(0);
	});

	test("a dispatch failure rejects the inventory job", async () => {
		const operation = reevaluateOpenPullRequests({
			github: {
				rest: {
					pulls: { list: async () => ({ data: [{ number: 7, head: { sha: "head-7" } }] }) },
					repos: {
						createDispatchEvent: async () => {
							throw new Error("dispatch denied");
						},
					},
				},
			},
			context: { repo: { owner: "helios", repo: "lab" }, sha: "constitution-head" },
		});

		await expect(operation).rejects.toThrow("dispatch denied");
	});

	test("repository contract reports the production workflow green", () => {
		const workflow = readFileSync(workflowPath, "utf8");
		const report = createConstitutionReevaluationReport(workflow);

		expect(report.status).toBe("pass");
		expect(report.findings).toHaveLength(0);
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
