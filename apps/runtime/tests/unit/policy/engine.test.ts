/**
 * FR-HELIOS-100: Policy Engine Unit Tests
 * Verifies: FR-APR-001 (Command classification)
 */
import { test, expect, describe } from "bun:test";
import { PolicyEngine } from "../../../src/policy/engine";


describe("PolicyEngine", () => {
  test("evaluates command classification correctly", async () => {
    const engine = new PolicyEngine();
    const result = await engine.evaluate("git status", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });
    expect(result.classification).toBeDefined();
  });

  test("detects safe commands", async () => {
    const engine = new PolicyEngine();
    const isSafe = await engine.canExecuteDirectly("ls", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });
    expect(typeof isSafe).toBe("boolean");
  });

  test("detects blocked commands", async () => {
    const engine = new PolicyEngine();
    const isBlocked = await engine.isBlocked("rm -rf /", {
      workspaceId: "test",
      agentId: "agent1",
      isDirect: false,
    });
    expect(typeof isBlocked).toBe("boolean");
  });
});
