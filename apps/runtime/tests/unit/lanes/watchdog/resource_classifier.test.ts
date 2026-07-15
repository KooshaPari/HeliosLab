/**
 * FR-HELIOS-075: Orphan Resource Classifier Tests
 * Verifies: FR-ORF-006 (Resource classification by type, age, owner, risk level)
 */
import { describe, it, expect } from "bun:test";
import {
  ResourceClassifier,
  type OrphanedResource,
} from "../../../../src/lanes/watchdog/resource_classifier.js";

describe("ResourceClassifier", () => {
  it("should classify resource with low risk (recent, known owner)", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const resource: OrphanedResource = {
      type: "worktree",
      path: "/tmp/lane-abc123",
      createdAt: thirtyMinutesAgo.toISOString(),
      estimatedOwnerId: "lane-abc123",
    };

    const classified = classifier.classify(resource);
    expect(classified.riskLevel).toBe("low");
    expect(classified.estimatedOwner).toBe("lane-abc123");
    expect(classified.age).toBeGreaterThan(0);
  });

  it("should classify resource with medium risk (1-24 hours, known owner)", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const resource: OrphanedResource = {
      type: "zellij_session",
      path: "session-xyz",
      createdAt: twelveHoursAgo.toISOString(),
      estimatedOwnerId: "lane-xyz",
    };

    const classified = classifier.classify(resource);
    expect(classified.riskLevel).toBe("medium");
    expect(classified.estimatedOwner).toBe("lane-xyz");
  });

  it("should classify resource with high risk (>24 hours, known owner)", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const resource: OrphanedResource = {
      type: "pty_process",
      pid: 12345,
      createdAt: twoDaysAgo.toISOString(),
      estimatedOwnerId: "lane-old",
    };

    const classified = classifier.classify(resource);
    expect(classified.riskLevel).toBe("high");
  });

  it("should classify resource with high risk (unknown owner)", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const resource: OrphanedResource = {
      type: "worktree",
      path: "/tmp/unknown-worktree",
      createdAt: thirtyMinutesAgo.toISOString(),
      // No estimatedOwnerId
    };

    const classified = classifier.classify(resource);
    expect(classified.riskLevel).toBe("high");
    expect(classified.estimatedOwner).toBe("unknown");
  });

  it("should sort classified resources by risk level", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();

    const resources: OrphanedResource[] = [
      {
        type: "worktree",
        path: "/tmp/recent",
        createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        estimatedOwnerId: "lane-1",
      },
      {
        type: "zellij_session",
        path: "session-2",
        createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        estimatedOwnerId: "lane-2",
      },
      {
        type: "pty_process",
        pid: 999,
        createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        // Unknown owner = high risk
      },
    ];

    const classified = classifier.classifyAll(resources);

    // Should be sorted: high, medium, low
    expect(classified[0].riskLevel).toBe("high");
    expect(classified[1].riskLevel).toBe("medium");
    expect(classified[2].riskLevel).toBe("low");
  });

  it("should preserve resource metadata during classification", () => {
    const classifier = new ResourceClassifier();
    const now = new Date();

    const resource: OrphanedResource = {
      type: "worktree",
      path: "/tmp/lane-abc",
      createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      estimatedOwnerId: "lane-abc",
      metadata: {
        branch: "main",
        headCommit: "abc123",
      },
    };

    const classified = classifier.classify(resource);
    expect(classified.metadata?.branch).toBe("main");
    expect(classified.metadata?.headCommit).toBe("abc123");
  });
});
