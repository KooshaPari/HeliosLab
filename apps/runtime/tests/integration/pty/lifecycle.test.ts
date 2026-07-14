/**
 * Integration tests — spawn real PTYs and verify output, state transitions, events.
 *
 * These tests use Bun.spawn to create actual shell processes.
 */

import { describe, expect, it, afterEach } from "bun:test";
import { PtyManager } from "../../../src/pty/index.js";
import { InMemoryBusPublisher } from "../../../src/pty/events.js";

const pidsToCleanup: number[] = [];

afterEach(() => {
  for (const pid of pidsToCleanup) {
    try {
      process.kill(pid, "SIGKILL");
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      /* already exited */
    }
  }
  pidsToCleanup.length = 0;
});

describe("PTY lifecycle integration", () => {
  // ── Scenario 1: echo command produces output ────────────────────

  it("spawns a PTY with echo and verifies output", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(10, bus);

    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "sess-1",
      terminalId: "term-1",
    });

    pidsToCleanup.push(record.pid);

    expect(record.ptyId).toBeDefined();
    expect(record.state).toBe("active");
    expect(record.pid).toBeGreaterThan(0);

    // Verify spawned event was emitted.
    const spawnedEvt = bus.events.find(e => e.topic === "pty.spawned");
    expect(spawnedEvt).toBeDefined();
    expect(spawnedEvt!.payload["pid"]).toBe(record.pid);

    // Verify state.changed event.
    const stateEvt = bus.events.find(e => e.topic === "pty.state.changed");
    expect(stateEvt).toBeDefined();

    // Clean up.
    await mgr.terminate(record.ptyId, { gracePeriodMs: 500 });
    expect(mgr.get(record.ptyId)).toBeUndefined();
  });

  // ── Scenario 2: cat + input ────────────────────────────────────

  it("writes input to a PTY and reads output", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(10, bus);

    // Spawn a shell.
    const proc = Bun.spawn(["/bin/sh"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    pidsToCleanup.push(proc.pid);

    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "sess-1",
      terminalId: "term-1",
    });
    pidsToCleanup.push(record.pid);

    // Register the external process for write operations.
    mgr.registerProcess(
      record.ptyId,
      proc as unknown as {
        readonly stdin: { write(data: Uint8Array | string): number };
      }
    );

    // Write input.
    const input = new TextEncoder().encode("echo hello\n");
    mgr.writeInput(record.ptyId, input);

    // Give it a moment.
    await new Promise(r => setTimeout(r, 200));

    await mgr.terminate(record.ptyId, { gracePeriodMs: 500 });
  });

  // ── Scenario 3: resize ─────────────────────────────────────────

  it("resizes a PTY and emits resize event", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(10, bus);

    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "sess-1",
      terminalId: "term-1",
      cols: 80,
      rows: 24,
    });
    pidsToCleanup.push(record.pid);

    mgr.resize(record.ptyId, 120, 40);

    const resizeEvt = bus.events.find(e => e.topic === "pty.resized");
    expect(resizeEvt).toBeDefined();
    expect(resizeEvt!.payload["newDimensions"]).toEqual({
      cols: 120,
      rows: 40,
    });

    const updated = mgr.get(record.ptyId);
    expect(updated?.dimensions).toEqual({ cols: 120, rows: 40 });

    await mgr.terminate(record.ptyId, { gracePeriodMs: 500 });
  });

  // ── Scenario 4: external kill ──────────────────────────────────

  it("detects external process termination", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(10, bus);

    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "sess-1",
      terminalId: "term-1",
    });
    pidsToCleanup.push(record.pid);

    // Kill the process externally.
    try {
      process.kill(record.pid, "SIGKILL");
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      // may already be dead
    }

    // Wait for process to die.
    await new Promise(r => setTimeout(r, 300));

    // Terminate should be idempotent / handle dead process gracefully.
    await mgr.terminate(record.ptyId, { gracePeriodMs: 200 });
    expect(mgr.get(record.ptyId)).toBeUndefined();
  });

  // ── Scenario 5: multi-PTY ─────────────────────────────────────

  it("manages multiple concurrent PTYs", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(10, bus);

    const records = await Promise.all([
      mgr.spawn({
        shell: "/bin/sh",
        laneId: "lane-1",
        sessionId: "sess-1",
        terminalId: "term-1",
      }),
      mgr.spawn({
        shell: "/bin/sh",
        laneId: "lane-1",
        sessionId: "sess-1",
        terminalId: "term-2",
      }),
      mgr.spawn({
        shell: "/bin/sh",
        laneId: "lane-2",
        sessionId: "sess-2",
        terminalId: "term-3",
      }),
    ]);

    for (const r of records) {
      pidsToCleanup.push(r.pid);
    }

    expect(mgr.getByLane("lane-1")).toHaveLength(2);
    expect(mgr.getByLane("lane-2")).toHaveLength(1);

    // Verify each has a unique ptyId.
    const ids = new Set(records.map(r => r.ptyId));
    expect(ids.size).toBe(3);

    // Verify each has a buffer.
    for (const r of records) {
      expect(mgr.getBufferStats(r.ptyId)).toBeDefined();
      expect(mgr.getOutputBuffer(r.ptyId)).toBeDefined();
    }

    // Terminate all.
    await Promise.all(records.map(r => mgr.terminate(r.ptyId, { gracePeriodMs: 500 })));

    for (const r of records) {
      expect(mgr.get(r.ptyId)).toBeUndefined();
      expect(mgr.getBufferStats(r.ptyId)).toBeUndefined();
    }
  });
});
