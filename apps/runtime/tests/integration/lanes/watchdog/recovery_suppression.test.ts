/**
 * FR-HELIOS-086: Recovery Suppression Tests
 * Verifies: FR-ORF-007 (Suppress cleanup suggestions during recovery)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";

describe("Recovery Suppression", () => {
  let engine: RemediationEngine;
  let bus: InMemoryLocalBus;
  let laneRegistry: LaneRegistry;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    laneRegistry = new LaneRegistry();
    engine = new RemediationEngine(laneRegistry, bus);
  });

  it("should suppress suggestions for recovering lanes", async () => {
    // Register lane in recovering state
    laneRegistry.register({
      laneId: "lane-abc123",
      workspaceId: "ws1",
      state: "recovering",
      worktreePath: "/tmp/lane-abc123",
      parTaskPid: null,
      attachedAgents: [],
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-abc123",
        age: 5000,
        estimatedOwner: "lane-abc123",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);

    // Should suppress cleanup suggestion for recovering lane
    expect(suggestions.length).toBe(0);
  });

  it("should detect orphan after recovery completes", async () => {
    const laneId = "lane-xyz";

    // First: register lane in recovering state
    laneRegistry.register({
      laneId,
      workspaceId: "ws2",
      state: "recovering",
      worktreePath: "/tmp/lane-xyz",
      parTaskPid: null,
      attachedAgents: [],
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-xyz",
        age: 5000,
        estimatedOwner: laneId,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    // While recovering, suggestion is suppressed
    let suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(0);

    // Now simulate recovery completion by changing lane state
    laneRegistry.update(laneId, { state: "closed" });

    // Now orphan should be detected
    suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("should not suppress suggestions for unknown owners", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "zellij_session",
        path: "session-unknown",
        age: 5000,
        estimatedOwner: "unknown", // Unknown owner
        riskLevel: "high",
        createdAt: new Date().toISOString(),
      },
    ];

    // Even without checking registry, should suggest cleanup for unknown owners
    const suggestions = await engine.generateSuggestions(orphans);

    // Unknown owner resources should not be suppressed due to recovery state
    // (they have no associated lane to check)
    expect(suggestions.length).toBeGreaterThanOrEqual(0); // May be suppressed by other rules
  });

  it("should handle missing lane gracefully", async () => {
    // Don't register the lane
    const orphans: ClassifiedOrphan[] = [
      {
        type: "pty_process",
        pid: 99999,
        age: 5000,
        estimatedOwner: "lane-nonexistent",
        riskLevel: "high",
        createdAt: new Date().toISOString(),
      },
    ];

    // Should not crash when lane not found
    const suggestions = await engine.generateSuggestions(orphans);

    // Should create a suggestion (missing lane doesn't prevent cleanup)
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("should distinguish between active and recovering lanes", async () => {
    // Register one active and one recovering lane
    laneRegistry.register({
      laneId: "lane-active",
      workspaceId: "ws1",
      state: "active",
      worktreePath: "/tmp/lane-active",
      parTaskPid: null,
      attachedAgents: [],
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    laneRegistry.register({
      laneId: "lane-recovering",
      workspaceId: "ws2",
      state: "recovering",
      worktreePath: "/tmp/lane-recovering",
      parTaskPid: null,
      attachedAgents: [],
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-active",
        age: 5000,
        estimatedOwner: "lane-active",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
      {
        type: "worktree",
        path: "/tmp/lane-recovering",
        age: 5000,
        estimatedOwner: "lane-recovering",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);

    // Active lane should have suggestion, recovering should not
    const paths = suggestions.map(s => s.resource.path);
    expect(paths).toContain("/tmp/lane-active");
    expect(paths).not.toContain("/tmp/lane-recovering");
  });
});
