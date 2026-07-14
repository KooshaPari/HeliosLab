/**
 * Unit tests for GhosttyProcess (T002).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GhosttyProcess, GhosttyProcessError } from "../process.js";

describe("GhosttyProcess", () => {
  let proc: GhosttyProcess;

  beforeEach(() => {
    proc = new GhosttyProcess();
  });

  test("initial state: not running, no pid", () => {
    expect(proc.isRunning()).toBe(false);
    expect(proc.getPid()).toBeUndefined();
    expect(proc.getUptime()).toBe(0);
  });

  test("stop when not running is idempotent", async () => {
    await proc.stop(); // Should not throw
    expect(proc.isRunning()).toBe(false);
  });

  test("start when already running throws", async () => {
    // Use a long-lived process to test double-start
    await proc.start({ binaryPath: "sleep", extraArgs: ["10"] });
    expect(proc.isRunning()).toBe(true);

    await expect(proc.start({ binaryPath: "sleep", extraArgs: ["10"] })).rejects.toThrow(
      GhosttyProcessError
    );

    await proc.stop();
  });

  test("start with a real process returns pid", async () => {
    const { pid } = await proc.start({
      binaryPath: "sleep",
      extraArgs: ["10"],
    });
    expect(typeof pid).toBe("number");
    expect(pid).toBeGreaterThan(0);
    expect(proc.isRunning()).toBe(true);
    expect(proc.getPid()).toBe(pid);

    await proc.stop();
    expect(proc.isRunning()).toBe(false);
    expect(proc.getPid()).toBeUndefined();
  });

  test("stop follows graceful shutdown", async () => {
    await proc.start({ binaryPath: "sleep", extraArgs: ["60"] });
    expect(proc.isRunning()).toBe(true);

    await proc.stop();
    expect(proc.isRunning()).toBe(false);
  });

  test("uptime increases while running", async () => {
    await proc.start({ binaryPath: "sleep", extraArgs: ["10"] });
    const uptime1 = proc.getUptime();
    // Wait a tiny bit
    await new Promise(r => setTimeout(r, 10));
    const uptime2 = proc.getUptime();
    expect(uptime2).toBeGreaterThanOrEqual(uptime1);

    await proc.stop();
    expect(proc.getUptime()).toBe(0);
  });

  test("crash handler fires on unexpected exit", async () => {
    let crashError: Error | undefined;
    proc.onCrash(err => {
      crashError = err;
    });

    // Start a process that exits immediately (simulates crash)
    await proc.start({ binaryPath: "true" });

    // Wait for the exit handler to fire
    await new Promise(r => setTimeout(r, 100));

    expect(crashError).toBeDefined();
    expect(crashError!.message).toContain("unexpectedly");
  });

  test("restart cycles cleanly", async () => {
    await proc.start({ binaryPath: "sleep", extraArgs: ["60"] });
    const pid1 = proc.getPid();

    const { pid: pid2 } = await proc.restart();
    expect(pid2).not.toBe(pid1);
    expect(proc.isRunning()).toBe(true);

    await proc.stop();
  });
});
