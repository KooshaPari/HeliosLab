/**
 * Policy Engine Unit Tests
 * Verifies: FR-APR-002 (classification) and FR-APR-003 (deny-by-default)
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyEngine } from "../../../src/policy/engine";
import { PolicyClassification, PolicyPatternType } from "../../../src/policy/types";

let policyDir: string | undefined;
let engine: PolicyEngine | undefined;

afterEach(async () => {
  engine?.close();
  engine = undefined;
  if (policyDir) await rm(policyDir, { recursive: true, force: true });
  policyDir = undefined;
});

describe("PolicyEngine", () => {
  test("loads and evaluates workspace-scoped classifications", async () => {
    policyDir = await mkdtemp(join(tmpdir(), "helios-policy-"));
    await writeFile(join(policyDir, "test.json"), JSON.stringify([
      {
        id: "git-safe",
        pattern: "git *",
        patternType: PolicyPatternType.Glob,
        classification: PolicyClassification.Safe,
        scope: "test",
        priority: 10,
        description: "Allow git commands",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "push-approval",
        pattern: "git push*",
        patternType: PolicyPatternType.Glob,
        classification: PolicyClassification.NeedsApproval,
        scope: "test",
        priority: 5,
        description: "Review pushes",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]));
    engine = new PolicyEngine(policyDir);

    const safe = await engine.evaluate("git status", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });
    const approval = await engine.evaluate("git push origin main", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(safe.classification).toBe(PolicyClassification.Safe);
    expect(approval.classification).toBe(PolicyClassification.NeedsApproval);
  });

  test("denies unmatched commands by default", async () => {
    policyDir = await mkdtemp(join(tmpdir(), "helios-policy-"));
    engine = new PolicyEngine(policyDir);
    const result = await engine.evaluate("curl https://example.com", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.Blocked);
    expect(result.deniedByDefault).toBe(true);
  });
});
