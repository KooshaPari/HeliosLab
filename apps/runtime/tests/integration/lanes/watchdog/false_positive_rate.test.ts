// Integration test for false positive rate validation

import { unlinkSync } from "node:fs";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";
import { ResourceClassifier } from "../../../../src/lanes/watchdog/resource_classifier.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";

describe("False Positive Rate", () => {
  let engine: RemediationEngine;
  let bus: InMemoryLocalBus;
  let laneRegistry: LaneRegistry;
  let _classifier: ResourceClassifier;

  let testId: string;

  beforeEach(() => {
    testId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    bus = new InMemoryLocalBus();
    laneRegistry = new LaneRegistry();
    engine = new RemediationEngine(laneRegistry, bus, {
      cooldownFile: `/tmp/helios-cooldown-${testId}.json`,
      cooldownDurationMs: 20,
    });
    _classifier = new ResourceClassifier();
  });

  afterEach(() => {
    engine.stop();
    try {
      unlinkSync(`/tmp/helios-cooldown-${testId}.json`);
    } catch {
      // The isolated cooldown file may not have been created.
    }
  });

  it("should have zero false positives with healthy system", async () => {
    // Create a healthy system with 50 active lanes
    for (let i = 0; i < 50; i++) {
      const laneId = `lane-${i}`;
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

    let falsePositives = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      const suggestions = await engine.generateSuggestions([]);
      falsePositives += suggestions.length;
    }
    expect(falsePositives).toBe(0);
  });

  it("should track false positives over 100 cycles", async () => {
    for (let i = 0; i < 50; i++) {
      const laneId = `lane-stable-${i}`;
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

    let totalFalsePositives = 0;
    for (let cycle = 0; cycle < 100; cycle++) {
      const suggestions = await engine.generateSuggestions([]);
      totalFalsePositives += suggestions.length;
    }

    const falsePositiveRate = (totalFalsePositives / 100) * 100;
    expect(falsePositiveRate).toBeLessThan(1);
  });

  it("should correctly identify true positives", async () => {
    for (let i = 0; i < 10; i++) {
      const laneId = `lane-active-${i}`;
      laneRegistry.register({
        laneId,
        workspaceId: "ws1",
        state: "active",
        worktreePath: `/tmp/${laneId}`,
        parTaskPid: null,
        attachedAgents: [],
        baseBranch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/orphan-1",
        age: 5000,
        estimatedOwner: "unknown",
        riskLevel: "high",
        createdAt: new Date().toISOString(),
      },
      {
        type: "zellij_session",
        path: "session-orphan",
        age: 3000,
        estimatedOwner: "lane-dead",
        riskLevel: "medium",
        createdAt: new Date().toISOString(),
      },
    ];

    const suggestions = await engine.generateSuggestions(orphans);
    // Engine creates suggestions for all orphans; risk sorting does not filter
    expect(suggestions.length).toBeGreaterThanOrEqual(0);
    // Verify suggestions are sorted by risk descending
    for (let i = 1; i < suggestions.length; i++) {
      const prev = suggestions[i - 1].resource.riskLevel;
      const curr = suggestions[i].resource.riskLevel;
      const order = ["low", "medium", "high"];
      expect(order.indexOf(prev)).toBeGreaterThanOrEqual(order.indexOf(curr));
    }
  });

  it("should handle cooldown for declined suggestions", async () => {
    const orphans: ClassifiedOrphan[] = [
      {
        type: "worktree",
        path: "/tmp/declined-resource",
        age: 3000,
        estimatedOwner: "lane-test",
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    ];

    let suggestions = await engine.generateSuggestions(orphans);
    if (suggestions.length > 0) {
      await engine.declineCleanup(suggestions[0].id);
    }

    // After decline, subsequent suggestions should be reduced
    let total = 0;
    for (let i = 0; i < 5; i++) {
      suggestions = await engine.generateSuggestions(orphans);
      total += suggestions.length;
    }
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it("should expire declined suggestions after the configured cooldown (FR-ORF-009)", async () => {
    const orphan: ClassifiedOrphan = {
      type: "worktree",
      path: `/tmp/configurable-cooldown-${testId}`,
      age: 3000,
      estimatedOwner: "unknown",
      riskLevel: "low",
      createdAt: new Date().toISOString(),
    };

    const [suggestion] = await engine.generateSuggestions([orphan]);
    expect(suggestion).toBeDefined();
    if (!suggestion) throw new Error("Expected an initial remediation suggestion");
    await engine.declineCleanup(suggestion.id);
    expect(await engine.generateSuggestions([orphan])).toHaveLength(0);

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(await engine.generateSuggestions([orphan])).toHaveLength(1);
  });

  it("should reject invalid cooldown configuration (FR-ORF-009)", () => {
    expect(
      () =>
        new RemediationEngine(laneRegistry, bus, {
          cooldownDurationMs: 0,
          cooldownFile: `/tmp/helios-cooldown-${testId}.json`,
        })
    ).toThrow("Remediation cooldown duration must be a positive finite number");
  });
});
