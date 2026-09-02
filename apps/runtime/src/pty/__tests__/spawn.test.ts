import { describe, expect, it, afterEach } from "bun:test";
import { spawnPty } from "../spawn.js";
import { PtyRegistry } from "../registry.js";

// Traces to: FR-PTY-001 (state machine), FR-PTY-002 (process registry), FR-PTY-003 (spawn operation)
describe("spawnPty()", () => {
  const pidsToCleanup: number[] = [];
  let registry: PtyRegistry;

  afterEach(() => {
    // Clean up spawned processes
    for (const pid of pidsToCleanup) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already exited
      }
    }
    pidsToCleanup.length = 0;
  });

  it("spawns a PTY with valid PID and registers it", async () => {
    registry = new PtyRegistry();
    const result = await spawnPty(
      {
        shell: "/bin/sh",
        laneId: "lane-1",
        sessionId: "session-1",
        terminalId: "term-1",
      },
      registry
    );

    pidsToCleanup.push(result.record.pid);

    expect(result.record.pid).toBeGreaterThan(0);
    expect(result.record.state).toBe("active");
    expect(result.record.laneId).toBe("lane-1");
    expect(result.record.dimensions).toEqual({ cols: 80, rows: 24 });
    expect(result.spawnLatencyMs).toBeGreaterThanOrEqual(0);

    // Verify it's in the registry
    expect(registry.get(result.record.ptyId)).toBe(result.record);
    expect(registry.count()).toBe(1);
  });

  it("uses custom dimensions", async () => {
    registry = new PtyRegistry();
    const result = await spawnPty(
      {
        shell: "/bin/sh",
        cols: 120,
        rows: 40,
        laneId: "lane-1",
        sessionId: "session-1",
        terminalId: "term-1",
      },
      registry
    );

    pidsToCleanup.push(result.record.pid);

    expect(result.record.dimensions).toEqual({ cols: 120, rows: 40 });
  });

  it("transitions to errored on invalid shell", async () => {
    registry = new PtyRegistry();
    await expect(
      spawnPty(
        {
          shell: "/nonexistent/shell",
          laneId: "lane-1",
          sessionId: "session-1",
          terminalId: "term-1",
        },
        registry
      )
    ).rejects.toThrow();

    // Should NOT have registered an incomplete record
    expect(registry.count()).toBe(0);
  });

  it("measures spawn latency", async () => {
    registry = new PtyRegistry();
    const result = await spawnPty(
      {
        shell: "/bin/sh",
        laneId: "lane-1",
        sessionId: "session-1",
        terminalId: "term-1",
      },
      registry
    );

    pidsToCleanup.push(result.record.pid);

    expect(result.spawnLatencyMs).toBeLessThan(5000); // generous bound
  });
});
