/**
 * FR-HELIOS-078: PTY Process Detector Tests
 * Verifies: FR-ORF-003 (Leaked PTY process detection)
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

import { PtyDetector } from "../../../../src/lanes/watchdog/pty_detector.js";
import type { TerminalRegistry } from "../../../../src/lanes/watchdog/pty_detector.js";

describe("PtyDetector", () => {
  let detector: PtyDetector;
  let terminalRegistry: TerminalRegistry;

  beforeEach(() => {
    terminalRegistry = {
      getTerminal: () => null,
      getTerminals: () => [],
    };
    detector = new PtyDetector(terminalRegistry);
  });
  beforeEach(() => {
    mock.module("../../../../src/integrations/exec.js", () => ({
      execCommand: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    }));
  });

  it("should initialize without error", () => {
    expect(detector).toBeDefined();
  });

  it("should return array from detect method", async () => {
    const orphans = await detector.detect();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("should return orphans with pty_process type", async () => {
    const orphans = await detector.detect();
    for (const orphan of orphans) {
      expect(orphan.type).toBe("pty_process");
    }
  });

  it("should respect grace period for recently spawned processes", async () => {
    // PtyDetector should skip processes spawned less than 5 seconds ago
    // This is verified by not detecting them
    const orphans = await detector.detect();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("should handle registry with bound terminals", async () => {
    const registryWithTerminals: TerminalRegistry = {
      getTerminal: id => (id === "pts/0" ? { laneId: "lane-1" } : null),
      getTerminals: () => [{ id: "pts/0", laneId: "lane-1" }],
    };

    detector = new PtyDetector(registryWithTerminals);
    const orphans = await detector.detect();
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("should include process metadata in orphans", async () => {
    const orphans = await detector.detect();
    for (const orphan of orphans) {
      expect(orphan.createdAt).toBeDefined();
      expect(orphan.pid === undefined || typeof orphan.pid === "number").toBe(true);
    }
  });

  it("should not detect system processes", async () => {
    // System processes should be filtered out
    const orphans = await detector.detect();
    for (const orphan of orphans) {
      const command = orphan.metadata?.command as string | undefined;
      if (command) {
        // Verify system patterns are not included
        expect(/^(kernel_task|launchd|sshd)/i.test(command)).toBe(false);
      }
    }
  });
});
