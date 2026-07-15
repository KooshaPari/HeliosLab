import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendGovernanceEntry, validateGovernanceLog } from "../governance-log";
import type { GovernanceLogEntry } from "../governance-types";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

function entry(prNumber: number): GovernanceLogEntry {
	return {
		prNumber,
		title: `PR ${prNumber}`,
		author: "agent",
		reviewers: [{ name: "reviewer", role: "agent", decision: "approved" }],
		gateResults: {
			qualityGates: true,
			gcaReview: true,
			coderabbitReview: true,
			complianceCheck: true,
		},
		complianceAttestation: true,
		exceptionADRs: [],
		selfMerge: false,
		mergeCommitSha: String(prNumber).padStart(40, "a"),
		timestamp: new Date(1_700_000_000_000 + prNumber).toISOString(),
	};
}

describe("governance log", () => {
	test("appends records without rewriting prior lines", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "governance-log-"));
		const logPath = join(tempDir, "governance-log.jsonl");

		await appendGovernanceEntry(entry(1), logPath);
		const firstContent = await readFile(logPath, "utf-8");
		await appendGovernanceEntry(entry(2), logPath);
		const finalContent = await readFile(logPath, "utf-8");

		expect(finalContent.startsWith(firstContent)).toBe(true);
		expect(finalContent.trim().split("\n")).toHaveLength(2);
		expect(await validateGovernanceLog(logPath)).toMatchObject({
			valid: true,
			totalEntries: 2,
		});
	});

	test("rejects malformed records before appending", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "governance-log-"));
		const logPath = join(tempDir, "governance-log.jsonl");
		const invalid = { ...entry(1), mergeCommitSha: "short" };

		await expect(appendGovernanceEntry(invalid, logPath)).rejects.toThrow("mergeCommitSha");
	});
});
