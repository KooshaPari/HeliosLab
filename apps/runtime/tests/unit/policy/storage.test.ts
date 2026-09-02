import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyStorage } from "../../../src/policy/storage.js";
import {
  PolicyClassification,
  PolicyPatternType,
  type PolicyRule,
} from "../../../src/policy/types.js";

let tempDir: string;
let policyDir: string;
let storage: PolicyStorage;

function makeRule(scope: string): PolicyRule {
  const now = new Date().toISOString();
  return {
    id: "allow-status",
    pattern: "git status",
    patternType: PolicyPatternType.Glob,
    classification: PolicyClassification.Safe,
    scope,
    priority: 10,
    description: "Allow git status",
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "policy-storage-"));
  policyDir = join(tempDir, "policies");
  await mkdir(policyDir);
  storage = new PolicyStorage(policyDir);
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("PolicyStorage validation", () => {
  it("round-trips valid workspace-scoped rules", async () => {
    const rules = [makeRule("workspace_1")];
    await storage.saveRules("workspace_1", rules);
    expect(await storage.loadRules("workspace_1")).toEqual(rules);
  });

  it("rejects workspace IDs that escape the policy directory", async () => {
    await expect(storage.saveRules("../escaped", [makeRule("../escaped")])).rejects.toThrow();
    await expect(readFile(join(tempDir, "escaped.json"), "utf-8")).rejects.toThrow();
  });

  it("rejects persisted rules scoped to another workspace", async () => {
    await writeFile(join(policyDir, "cross-scope.json"), JSON.stringify([makeRule("other")]));
    await expect(storage.loadRules("cross-scope")).rejects.toThrow(/scope/i);
  });
});
