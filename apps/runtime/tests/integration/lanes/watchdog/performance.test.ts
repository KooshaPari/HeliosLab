// Performance test for detection and remediation

import { describe, it, expect, beforeEach } from "bun:test";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";

describe("Performance", () => {
  let engine: RemediationEngine;
  let bus: InMemoryLocalBus;
  let laneRegistry: LaneRegistry;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    laneRegistry = new LaneRegistry(200);
    engine = new RemediationEngine(laneRegistry, bus);
  });

  it("should handle 100 lanes with 20 orphans efficiently", async () => {
    // Create 100 active lanes
    for (let i = 0; i < 100; i++) {
      const laneId = `lane-perf-${i}`;
      laneRegistry.register({
        laneId,
        workspaceId: `ws-${i}`,
        state: "active",
        worktreePath: `/tmp/${laneId}`,
        parTaskPid: null,
        attachedAgents: [],
        baseBranch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Create 20 orphaned resources
    const orphans: ClassifiedOrphan[] = [];
    for (let i = 0; i < 20; i++) {
      orphans.push({
        type: "worktree",
        path: `/tmp/orphan-wt-${i}`,
        age: 5000,
        estimatedOwner: `lane-dead-${i}`,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      });
    }

    // Measure suggestion generation time
    const startTime = Date.now();
    const suggestions = await engine.generateSuggestions(orphans);
    const duration = Date.now() - startTime;

    // Should complete quickly (under 500ms)
    expect(duration).toBeLessThan(500);
    expect(suggestions.length).toBe(20);
  });

  it("should handle large suggestion lists efficiently", async () => {
    // Create 50 orphaned resources
    const orphans: ClassifiedOrphan[] = [];
    for (let i = 0; i < 50; i++) {
      orphans.push({
        type: i % 3 === 0 ? "worktree" : i % 3 === 1 ? "zellij_session" : "pty_process",
        path: i % 3 !== 2 ? `/tmp/orphan-${i}` : undefined,
        pid: i % 3 === 2 ? 10000 + i : undefined,
        age: 5000,
        estimatedOwner: `lane-dead-${i}`,
        riskLevel: i % 2 === 0 ? "high" : "medium",
        createdAt: new Date().toISOString(),
      });
    }

    const startTime = Date.now();
    const suggestions = await engine.generateSuggestions(orphans);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(500);
    expect(suggestions.length).toBe(50);
  });

  it("should process multiple cycles quickly", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/persistent-orphan",
        age: 5000,
        estimatedOwner: "lane-test",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    const startTime = Date.now();

    // Run 100 detection cycles
    for (let i = 0; i < 100; i++) {
      await engine.generateSuggestions(orphans);
    }

    const totalDuration = Date.now() - startTime;
    const avgDuration = totalDuration / 100;

    // Average per cycle should be very fast (< 10ms)
    expect(avgDuration).toBeLessThan(10);
  });

  it("should scale with recovery suppression checks", async () => {
    // Create 50 lanes with various states
    for (let i = 0; i < 50; i++) {
      const laneId = `lane-state-${i}`;
      const state = i % 4 === 0 ? "recovering" : "active";

      laneRegistry.register({
        laneId,
        workspaceId: `ws-${i}`,
        state,
        worktreePath: `/tmp/${laneId}`,
        parTaskPid: null,
        attachedAgents: [],
        baseBranch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Create orphans for all lanes
    const orphans: ClassifiedOrphan[] = [];
    for (let i = 0; i < 50; i++) {
      orphans.push({
        type: "worktree",
        path: `/tmp/orphan-${i}`,
        age: 5000,
        estimatedOwner: `lane-state-${i}`,
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      });
    }

    const startTime = Date.now();
    const suggestions = await engine.generateSuggestions(orphans);
    const duration = Date.now() - startTime;

    // Should still complete quickly even with recovery checks
    expect(duration).toBeLessThan(500);

    // Should suppress some suggestions for recovering lanes (50 / 4 = ~12-13)
    expect(suggestions.length).toBeLessThan(50);
  });

  it("should handle cooldown map persistence efficiently", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/cooldown-test",
        age: 3000,
        estimatedOwner: "lane-test",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    // First cycle: generate suggestion
    let suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(1);

    // Decline it (triggers cooldown save)
    const startTime = Date.now();
    engine.declineCleanup(suggestions[0].id);
    const declineTime = Date.now() - startTime;

    // Decline should be fast (< 100ms)
    expect(declineTime).toBeLessThan(100);

    // Second cycle with cooldown active
    suggestions = await engine.generateSuggestions(orphans);
    expect(suggestions.length).toBe(0);
  });
});
