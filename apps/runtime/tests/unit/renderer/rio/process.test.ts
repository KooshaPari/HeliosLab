/**
 * FR-HELIOS-052: Rio Process Lifecycle Tests
 * Verifies: FR-RIO-001 (Renderer adapter interface), FR-RIO-007 (Crash handling)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { RioProcess } from "../../../../src/renderer/rio/process.js";

describe("RioProcess — initial state", () => {
  let proc: RioProcess;

  beforeEach(() => {
    proc = new RioProcess();
  });

  it("starts as not running", () => {
    expect(proc.isRunning()).toBe(false);
  });

  it("has undefined PID before start", () => {
    expect(proc.getPid()).toBeUndefined();
  });

  it("has undefined uptime before start", () => {
    expect(proc.getUptime()).toBeUndefined();
  });

  it("stop is safe when never started", async () => {
    await proc.stop(); // should not throw
    expect(proc.isRunning()).toBe(false);
  });

  it("writeToStdin is safe when not running", () => {
    // should not throw
    proc.writeToStdin(new Uint8Array([0x41]));
    expect(proc.isRunning()).toBe(false);
  });
});

describe("RioProcess — exit handler registration", () => {
  it("registers exit handlers", () => {
    const proc = new RioProcess();
    const calls: number[] = [];
    proc.onExit(code => calls.push(code));
    // Handler registered but not called since process never started.
    expect(calls.length).toBe(0);
  });
});
