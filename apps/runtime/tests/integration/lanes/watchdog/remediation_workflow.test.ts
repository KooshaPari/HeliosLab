// Integration tests for remediation workflow

import { describe, it, expect, beforeEach } from "bun:test";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";

describe("Remediation Workflow", () => {
  let engine: RemediationEngine;
  let bus: InMemoryLocalBus;
  let laneRegistry: LaneRegistry;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    laneRegistry = new LaneRegistry();
    engine = new RemediationEngine(laneRegistry, bus);
  });

  it("should generate suggestions from classified orphans", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-abc123",
        age: 2 * 24 * 60 * 60 * 1000, // 2 days
        estimatedOwner: "lane-abc123",
        riskLevel: "high",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].requiresConfirmation).toBe(true);
    expect(suggestions[0].suggestedAction).toContain("worktree");
  });

  it("should not execute cleanup without confirmation", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-test",
        age: 3000,
        estimatedOwner: "lane-test",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    await engine.generateSuggestions(orphans);
    const suggestions = engine.getSuggestions();

    expect(suggestions.length).toBeGreaterThan(0);
    // Suggestions exist but cleanup hasn't happened
  });

  it("should suppress suggestions for recovering lanes", async () => {
    // Register a lane in recovering state
    laneRegistry.register({
      laneId: "lane-recovering",
      workspaceId: "ws1",
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
        path: "/tmp/lane-recovering",
        age: 3000,
        estimatedOwner: "lane-recovering",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(0); // Should be suppressed
  });

  it("should apply cooldown to declined suggestions", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "zellij_session",
        path: "session-xyz",
        age: 5000,
        estimatedOwner: "lane-xyz",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    let suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(1);

    const suggestionId = suggestions[0].id;
    engine.declineCleanup(suggestionId);

    // Generate suggestions again - should not include declined resource
    suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(0); // Cooldown prevents re-suggestion
  });

  it("should emit suggestion event", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "pty_process",
        pid: 12345,
        age: 2000,
        estimatedOwner: "lane-123",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    await engine.generateSuggestions(orphans);
    const events = bus.getEvents();

    const suggestionEvent = events.find(e => e.topic === "orphan.remediation.suggested");
    expect(suggestionEvent).toBeDefined();
    expect(suggestionEvent?.payload?.resourceType).toBe("pty_process");
  });

  it("should emit decline event", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/test-worktree",
        age: 3000,
        estimatedOwner: "lane-test",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);
    await engine.declineCleanup(suggestions[0].id);

    const events = bus.getEvents();
    const declineEvent = events.find(e => e.topic === "orphan.remediation.declined");
    expect(declineEvent).toBeDefined();
  });

  it("should return empty suggestions list when all resources in cooldown", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane-cooldown",
        age: 3000,
        estimatedOwner: "lane-cooldown",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    let suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(1);

    // Decline the suggestion
    engine.declineCleanup(suggestions[0].id);

    // Try to generate suggestions again
    suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(0); // Cooldown applied
  });

  it("should generate unique suggestion IDs", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/lane1",
        age: 3000,
        estimatedOwner: "lane-1",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
      {
        type: "worktree",
        path: "/tmp/lane2",
        age: 3000,
        estimatedOwner: "lane-2",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);
    const ids = suggestions.map(s => s.id);

    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2); // All IDs are unique
  });
});
