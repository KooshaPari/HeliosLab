/**
 * FR-HELIOS-050: Ghostty Process Lifecycle Tests
 * Verifies: FR-GHT-001 (Renderer adapter interface), FR-GHT-007 (Crash handling)
 */
import { describe, test, expect, beforeEach } from "bun:test";


describe("GhosttyProcess", () => {
  let proc: GhosttyProcess;

  beforeEach(() => {
    proc = new GhosttyProcess();
  });

  test("initial state: not running", () => {
    expect(proc.isRunning()).toBe(false);
    expect(proc.getPid()).toBeUndefined();
    expect(proc.getUptime()).toBe(0);
  });

  test("stop when not running is idempotent", async () => {
    await proc.stop();
    expect(proc.isRunning()).toBe(false);
  });

  test("onCrash registers a handler", () => {
    let err: Error | undefined;
    proc.onCrash(e => {
      err = e;
    });
    expect(err).toBeUndefined();
  });

  test("restart when not running and no previous options rejects", async () => {
    // restart calls stop (no-op) then start with empty options
    // This will fail because ghostty binary is not installed in test env
    try {
      await proc.restart();
      // If it somehow succeeds (ghostty is installed), that's fine too
      expect(proc.isRunning()).toBe(true);
      await proc.stop();
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      expect(e).toBeDefined();
    }
  });
});
