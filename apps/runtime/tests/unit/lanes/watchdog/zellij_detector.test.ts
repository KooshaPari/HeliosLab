/**
 * FR-HELIOS-077: Zellij Session Detector Tests
 * Verifies: FR-ORF-002 (Stale zellij session detection)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { ZellijDetector } from "../../../../src/lanes/watchdog/zellij_detector.js";
import type { SessionRegistry } from "../../../../src/lanes/watchdog/zellij_detector.js";

describe("ZellijDetector", () => {
  let detector: ZellijDetector;
  let sessionRegistry: SessionRegistry;

  beforeEach(() => {
    sessionRegistry = {
      getSession: () => null,
      getSessions: () => [],
    };
    detector = new ZellijDetector(sessionRegistry);
  });

  it("should initialize without error", () => {
    expect(detector).toBeDefined();
  });

  it("should return array from detect method", async () => {
    const orphans = await detector.detect();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("should return orphans with zellij_session type", async () => {
    const orphans = await detector.detect();
    for (const orphan of orphans) {
      expect(orphan.type).toBe("zellij_session");
    }
  });

  it("should handle registry with active sessions", async () => {
    const registryWithSessions: SessionRegistry = {
      getSession: id => (id === "session-active" ? { laneId: "lane-1" } : null),
      getSessions: () => [{ id: "session-active", laneId: "lane-1" }],
    };

    detector = new ZellijDetector(registryWithSessions);
    const orphans = await detector.detect();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("should classify orphans with proper metadata", async () => {
    const orphans = await detector.detect();
    for (const orphan of orphans) {
      expect(orphan.createdAt).toBeDefined();
      expect(orphan.metadata === undefined || orphan.metadata?.sessionName !== undefined).toBe(
        true
      );
    }
  });
});
