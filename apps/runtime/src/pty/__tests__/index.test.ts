import { describe, expect, it, afterEach } from "bun:test";
import { PtyManager, InMemoryBusPublisher } from "../index.js";

describe("PtyManager", () => {
  const pidsToCleanup: number[] = [];

  afterEach(() => {
    for (const pid of pidsToCleanup) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already exited
      }
    }
    pidsToCleanup.length = 0;
  });

  it("spawn and get", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(300, bus);
    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "session-1",
      terminalId: "term-1",
    });

    pidsToCleanup.push(record.pid);

    expect(record.state).toBe("active");
    expect(mgr.get(record.ptyId)).toBe(record);

    // Should have emitted spawned and state.changed events.
    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.spawned");
    expect(topics).toContain("pty.state.changed");
  });

  it("getByLane works", async () => {
    const mgr = new PtyManager();
    const r1 = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-A",
      sessionId: "s1",
      terminalId: "t1",
    });
    const r2 = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-A",
      sessionId: "s2",
      terminalId: "t2",
    });

    pidsToCleanup.push(r1.pid, r2.pid);

    expect(mgr.getByLane("lane-A")).toHaveLength(2);
    expect(mgr.getByLane("lane-B")).toHaveLength(0);
  });

  it("resize updates dimensions and emits events", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(300, bus);
    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "s1",
      terminalId: "t1",
    });

    pidsToCleanup.push(record.pid);
    bus.clear();

    mgr.resize(record.ptyId, 120, 40);

    const updated = mgr.get(record.ptyId);
    expect(updated?.dimensions).toEqual({ cols: 120, rows: 40 });

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.signal.delivered");
    expect(topics).toContain("pty.resized");
  });

  it("resize rejects invalid dimensions", async () => {
    const mgr = new PtyManager();
    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "s1",
      terminalId: "t1",
    });

    pidsToCleanup.push(record.pid);

    expect(() => mgr.resize(record.ptyId, 0, 24)).toThrow("Invalid PTY dimensions");
    expect(() => mgr.resize(record.ptyId, 80, -1)).toThrow("Invalid PTY dimensions");
    expect(() => mgr.resize(record.ptyId, 10001, 24)).toThrow("Invalid PTY dimensions");
  });

  it("resize rejects on stopped PTY", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(300, bus);
    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "s1",
      terminalId: "t1",
    });

    pidsToCleanup.push(record.pid);
    await mgr.terminate(record.ptyId);

    expect(() => mgr.resize(record.ptyId, 80, 24)).toThrow();
  });

  it("terminate cleans up PTY", async () => {
    const bus = new InMemoryBusPublisher();
    const mgr = new PtyManager(300, bus);
    const _record = await mgr.spawn({
      shell: "/bin/sh",
      laneId: "lane-1",
      sessionId: "s1",
      terminalId: "t1",
    });

    pidsToCleanup.push(record.pid);
    bus.clear();

    await mgr.terminate(record.ptyId, { gracePeriodMs: 100 });

    // Record should be removed from registry.
    expect(mgr.get(record.ptyId)).toBeUndefined();

    // Should have emitted terminating and stopped events.
    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.terminating");
    expect(topics).toContain("pty.stopped");
  });

  it("terminate is idempotent on missing PTY", async () => {
    const mgr = new PtyManager();
    // Should not throw.
    await mgr.terminate("nonexistent-pty-id");
  });

  it("writeInput throws for nonexistent PTY", () => {
    const mgr = new PtyManager();
    expect(() => mgr.writeInput("nonexistent", new Uint8Array([65]))).toThrow("not found");
  });

  it("reconcileOrphans completes without error", async () => {
    const mgr = new PtyManager();
    const summary = await mgr.reconcileOrphans();
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.found).toBeGreaterThanOrEqual(0);
  });
});
