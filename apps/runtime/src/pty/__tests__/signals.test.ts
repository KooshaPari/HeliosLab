import { describe, expect, it } from "bun:test";
import {
  resize,
  terminate,
  sendSighup,
  SignalHistory,
  InvalidDimensionsError,
} from "../signals.js";
import type { SignalHistoryMap } from "../signals.js";
import { PtyRegistry } from "../registry.js";
import type { PtyRecord } from "../registry.js";
import { PtyLifecycle } from "../state_machine.js";
import { InMemoryBusPublisher } from "../events.js";

function makeRecord(overrides?: Partial<PtyRecord>): PtyRecord {
  return {
    ptyId: "pty-test-1",
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    pid: 99999,
    state: "active",
    dimensions: { cols: 80, rows: 24 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    env: Object.freeze({}),
    ...overrides,
  };
}

function spawnShellProcess(): number {
  const proc = Bun.spawn(["/bin/sh"], {
    stdout: "pipe",
    stderr: "pipe",
  }) as { pid?: number };

  if (proc.pid === undefined) {
    throw new Error("Bun.spawn did not return a process ID");
  }

  return proc.pid;
}

const pidsToCleanup: number[] = [];

// Traces to: FR-PTY-004 (POSIX signals delivery)
describe("SignalHistory", () => {
  it("stores and retrieves envelopes", () => {
    const history = new SignalHistory(3);
    history.add({
      ptyId: "p1",
      signal: "SIGTERM",
      timestamp: 1,
      outcome: "delivered",
      pid: 1,
    });
    history.add({
      ptyId: "p1",
      signal: "SIGKILL",
      timestamp: 2,
      outcome: "escalated",
      pid: 1,
    });
    expect(history.length).toBe(2);
    expect(history.getAll()[0]!.signal).toBe("SIGTERM");
  });

  it("bounds history to maxRecords", () => {
    const history = new SignalHistory(2);
    history.add({
      ptyId: "p1",
      signal: "SIGWINCH",
      timestamp: 1,
      outcome: "delivered",
      pid: 1,
    });
    history.add({
      ptyId: "p1",
      signal: "SIGTERM",
      timestamp: 2,
      outcome: "delivered",
      pid: 1,
    });
    history.add({
      ptyId: "p1",
      signal: "SIGKILL",
      timestamp: 3,
      outcome: "escalated",
      pid: 1,
    });
    expect(history.length).toBe(2);
    expect(history.getAll()[0]!.signal).toBe("SIGTERM");
  });
});

describe("resize", () => {
  it("updates dimensions and emits events", () => {
    // Spawn a real child so SIGWINCH delivery succeeds.
    const pid = spawnShellProcess();
    pidsToCleanup.push(pid);

    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid });
    registry.register(record);
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    resize(record, 120, 40, registry, historyMap, bus);

    const updated = registry.get(record.ptyId);
    expect(updated?.dimensions).toEqual({ cols: 120, rows: 40 });

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.signal.delivered");
    expect(topics).toContain("pty.resized");

    // Check resize event payload includes old/new dimensions.
    const resizeEvt = bus.events.find(e => e.topic === "pty.resized");
    expect(resizeEvt?.payload["oldDimensions"]).toEqual({
      cols: 80,
      rows: 24,
    });
    expect(resizeEvt?.payload["newDimensions"]).toEqual({
      cols: 120,
      rows: 40,
    });
  });

  it("rejects invalid dimensions", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord();
    registry.register(record);
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    expect(() => resize(record, 0, 24, registry, historyMap, bus)).toThrow(InvalidDimensionsError);
    expect(() => resize(record, 80, 0, registry, historyMap, bus)).toThrow(InvalidDimensionsError);
    expect(() => resize(record, 10001, 24, registry, historyMap, bus)).toThrow(
      InvalidDimensionsError
    );
  });

  it("rejects resize on errored PTY", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ state: "errored" });
    registry.register(record);
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    expect(() => resize(record, 80, 24, registry, historyMap, bus)).toThrow("Cannot resize");
  });

  it("rejects resize on stopped PTY", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ state: "stopped" });
    registry.register(record);
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    expect(() => resize(record, 80, 24, registry, historyMap, bus)).toThrow("Cannot resize");
  });
});

describe("terminate", () => {
  it("terminates with SIGTERM and cleans up", async () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid: 99998 });
    registry.register(record);
    const lifecycle = new PtyLifecycle(record.ptyId, "active");
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    const mockIsAlive = () => false;
    const mockWait = async () => true;
    await terminate(
      record,
      lifecycle,
      registry,
      historyMap,
      bus,
      {
        gracePeriodMs: 50,
      },
      mockIsAlive,
      mockWait
    );

    expect(registry.get(record.ptyId)).toBeUndefined();

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.terminating");
    expect(topics).toContain("pty.stopped");
  });

  it("is idempotent on stopped PTY", async () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ state: "stopped" });
    // Don't register — already cleaned up.
    const lifecycle = new PtyLifecycle(record.ptyId, "stopped");
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    await terminate(record, lifecycle, registry, historyMap, bus);
    // No events emitted.
    expect(bus.events).toHaveLength(0);
  });

  it("escalates to SIGKILL after grace period", async () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid: 99999 });
    registry.register(record);
    const lifecycle = new PtyLifecycle(record.ptyId, "active");
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    // Mock: process stays alive through grace, then dies after SIGKILL.
    let killCount = 0;
    const mockIsAlive = (_pid: number): boolean => {
      killCount++;
      // Alive during grace period checks (first 2 calls), dead after SIGKILL.
      return killCount <= 2;
    };
    const mockWaitForExit = async (_pid: number, _timeoutMs: number): Promise<boolean> => {
      // First call (grace period): not exited.
      // Second call (post-SIGKILL): exited.
      if (killCount <= 1) {
        killCount++;
        return false;
      }
      return true;
    };

    await terminate(
      record,
      lifecycle,
      registry,
      historyMap,
      bus,
      { gracePeriodMs: 50 },
      mockIsAlive,
      mockWaitForExit
    );

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.force_killed");
    expect(topics).toContain("pty.stopped");
  });

  it("handles terminate on throttled PTY", async () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid: 99998, state: "throttled" });
    registry.register(record);
    const lifecycle = new PtyLifecycle(record.ptyId, "throttled");
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    const mockIsAlive = () => false;
    const mockWait = async () => true;
    await terminate(
      record,
      lifecycle,
      registry,
      historyMap,
      bus,
      {
        gracePeriodMs: 50,
      },
      mockIsAlive,
      mockWait
    );

    expect(registry.get(record.ptyId)).toBeUndefined();
  });
});

describe("sendSighup", () => {
  it("records successful delivery", () => {
    // Spawn a real child so SIGHUP has a valid target (not the test runner).
    const pid = spawnShellProcess();
    pidsToCleanup.push(pid);

    const _record = makeRecord({ pid });
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();
    const envelope = sendSighup(record, historyMap, bus);
    expect(envelope.outcome).toBe("delivered");
    expect(envelope.signal).toBe("SIGHUP");
    expect(historyMap.get(record.ptyId)?.length).toBe(1);
  });

  it("records failed delivery for dead process", () => {
    // Use a non-existent PID to avoid sending signals to the test process
    const _record = makeRecord({ pid: 999999 });
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    const envelope = sendSighup(record, historyMap, bus);

    expect(envelope.signal).toBe("SIGHUP");
    // Non-existent PID → delivery fails
    expect(envelope.outcome).toBe("failed");
    expect(envelope.error).toBeDefined();

    const history = historyMap.get(record.ptyId);
    expect(history?.length).toBe(1);
  });
});
