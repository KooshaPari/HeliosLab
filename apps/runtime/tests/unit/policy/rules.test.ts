/**
 * FR-HELIOS-101: Policy Rules Engine Unit Tests
 * Verifies: FR-APR-002 (Rule pattern matching), FR-APR-003 (Deny-by-default)
 */
import { test, expect, describe } from "bun:test";
import { PolicyRuleSet } from "../../../src/policy/rules";
import { PolicyClassification, PolicyPatternType } from "../../../src/policy/types";

describe("PolicyRuleSet", () => {
  test("glob pattern matches simple commands", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "git-safe",
      pattern: "git *",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 10,
      description: "Allow git commands",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("git status", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.Safe);
    expect(result.matchedRules.length).toBe(1);
  });

  test("regex pattern matches commands", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "rm-blocked",
      pattern: "^rm\\s+-rf",
      patternType: PolicyPatternType.Regex,
      classification: PolicyClassification.Blocked,
      scope: "test",
      priority: 10,
      description: "Block dangerous rm -rf",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("rm -rf /tmp", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.Blocked);
  });

  test("deny-by-default: unmatched command is blocked", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "git-safe",
      pattern: "git *",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 10,
      description: "Allow git commands",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("curl http://example.com", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.Blocked);
    expect(result.deniedByDefault).toBe(true);
  });

  test("denylist-wins: blocked rule overrides safe rule", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "cat-safe",
      pattern: "cat *",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 20,
      description: "Allow cat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ruleSet.addRule({
      id: "env-blocked",
      pattern: "cat *.env",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Blocked,
      scope: "test",
      priority: 10,
      description: "Block reading .env files",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("cat .env", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.Blocked);
    expect(result.matchedRules.length).toBe(2);
  });

  test("priority ordering: lower priority evaluates first", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "rule1",
      pattern: "test",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 20,
      description: "Rule 1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ruleSet.addRule({
      id: "rule2",
      pattern: "test",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Blocked,
      scope: "test",
      priority: 10,
      description: "Rule 2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("test", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    // Both should match, but denylist-wins applies
    expect(result.matchedRules.length).toBe(2);
    expect(result.classification).toBe(PolicyClassification.Blocked);
  });

  test("most-restrictive wins: needs-approval > safe", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "rule1",
      pattern: "echo *",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 20,
      description: "Rule 1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ruleSet.addRule({
      id: "rule2",
      pattern: "echo secret",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.NeedsApproval,
      scope: "test",
      priority: 10,
      description: "Rule 2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("echo secret", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.classification).toBe(PolicyClassification.NeedsApproval);
  });

  test("file target matching: rule with targets", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "rm-env",
      pattern: "rm *",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Blocked,
      scope: "test",
      priority: 10,
      description: "Block deleting .env files",
      targets: ["*.env"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const resultMatch = ruleSet.evaluate("rm file", {
      workspaceId: "test",
      agentId: "agent1",
      affectedPaths: ["config.env"],
      isDirect: false,
    });

    expect(resultMatch.classification).toBe(PolicyClassification.Blocked);

    const resultNoMatch = ruleSet.evaluate("rm file", {
      workspaceId: "test",
      agentId: "agent1",
      affectedPaths: ["config.txt"],
      isDirect: false,
    });

    expect(resultNoMatch.classification).toBe(PolicyClassification.Blocked);
    expect(resultNoMatch.deniedByDefault).toBe(true);
  });

  test("evaluation returns timing information", () => {
    const ruleSet = new PolicyRuleSet();
    ruleSet.addRule({
      id: "test",
      pattern: "test",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 10,
      description: "Test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = ruleSet.evaluate("test", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.evaluationMs).toBeGreaterThanOrEqual(0);
    expect(result.evaluationMs).toBeLessThan(50); // Should be fast
  });

  test("handles large rule sets efficiently", () => {
    const ruleSet = new PolicyRuleSet();

    // Add 100 rules
    for (let i = 0; i < 100; i++) {
      ruleSet.addRule({
        id: `rule${i}`,
        pattern: `pattern${i}`,
        patternType: PolicyPatternType.Glob,
        classification: PolicyClassification.Safe,
        scope: "test",
        priority: i,
        description: `Rule ${i}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const result = ruleSet.evaluate("test", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });

    expect(result.evaluationMs).toBeLessThan(50);
  });

  test("add and remove rules", () => {
    const ruleSet = new PolicyRuleSet();
    const rule = {
      id: "test",
      pattern: "test",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Safe,
      scope: "test",
      priority: 10,
      description: "Test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ruleSet.addRule(rule);
    expect(ruleSet.getRuleCount()).toBe(1);

    ruleSet.removeRule("test");
    expect(ruleSet.getRuleCount()).toBe(0);
  });
});
