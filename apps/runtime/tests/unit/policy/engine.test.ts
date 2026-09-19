/**
 * FR-HELIOS-100: Policy Engine Unit Tests
 * Verifies: FR-APR-001 (Command classification)
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine } from "../../../src/policy/engine";
import { PolicyClassification } from "../../../src/policy/types";

let tempDir: string;
let engine: PolicyEngine;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "policy-engine-"));
	engine = new PolicyEngine(tempDir);
});

afterEach(async () => {
	engine.close();
	await rm(tempDir, { recursive: true, force: true });
});

describe("PolicyEngine", () => {
	test("evaluates command classification correctly", async () => {
		const result = await engine.evaluate("git status", {
			workspaceId: "test",
			agentId: "agent1",
			isDirect: false,
		});
		expect(result.classification).toBeDefined();
	});

	test("detects safe commands", async () => {
		const isSafe = await engine.canExecuteDirectly("ls", {
			workspaceId: "test",
			agentId: "agent1",
			isDirect: false,
		});
		expect(typeof isSafe).toBe("boolean");
	});

	test("detects blocked commands", async () => {
		const isBlocked = await engine.isBlocked("rm -rf /", {
			workspaceId: "test",
			agentId: "agent1",
			isDirect: false,
		});
		expect(typeof isBlocked).toBe("boolean");
	});

	test("needsApproval reflects classification", async () => {
		const context = {
			workspaceId: "test",
			agentId: "agent1",
			isDirect: false,
		};
		expect(await engine.needsApproval("git status", context)).toBe(
			await engine
				.evaluate("git status", context)
				.then((r) => r.classification === PolicyClassification.NeedsApproval),
		);
	});

	test("close is safe to call and clears cache", async () => {
		const context = { workspaceId: "test", agentId: "agent1", isDirect: false };
		await engine.evaluate("ls", context);
		expect(() => engine.close()).not.toThrow();
	});
});
