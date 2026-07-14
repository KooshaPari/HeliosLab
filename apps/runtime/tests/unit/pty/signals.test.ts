/**
 * FR-HELIOS-041: PTY Signal Handling Tests
 * Verifies: FR-PTY-004 (POSIX signals: SIGTERM, SIGKILL, SIGWINCH, SIGHUP), FR-PTY-007 (Grace periods)
 * Traces to: FR-MVP-010 (terminal resize)
 */
import { describe, expect, it } from "bun:test";
import {
  resize,
  terminate,
  sendSighup,
  SignalHistory,
  InvalidDimensionsError,
} from "../../../src/pty/signals.js";
import type { SignalHistoryMap } from "../../../src/pty/signals.js";
import { PtyRegistry } from "../../../src/pty/registry.js";
import type { PtyRecord } from "../../../src/pty/registry.js";
import { PtyLifecycle } from "../../../src/pty/state_machine.js";
import { InMemoryBusPublisher } from "../../../src/pty/events.js";

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

describe("SignalHistory", () => {
  it("stores and retrieves envelopes", () => {
    const h = new SignalHistory(3);
    h.add({
      ptyId: "p1",
      signal: "SIGTERM",
      timestamp: 1,
      outcome: "delivered",
      pid: 1,
    });
    h.add({
      ptyId: "p1",
      signal: "SIGKILL",
      timestamp: 2,
      outcome: "escalated",
      pid: 1,
    });
    expect(h.length).toBe(2);
    expect(h.getAll()[0]!.signal).toBe("SIGTERM");
  });

  it("bounds history to maxRecords", () => {
    const h = new SignalHistory(2);
    h.add({
      ptyId: "p1",
      signal: "SIGWINCH",
      timestamp: 1,
      outcome: "delivered",
      pid: 1,
    });
    h.add({
      ptyId: "p1",
      signal: "SIGTERM",
      timestamp: 2,
      outcome: "delivered",
      pid: 1,
    });
    h.add({
      ptyId: "p1",
      signal: "SIGKILL",
      timestamp: 3,
      outcome: "escalated",
      pid: 1,
    });
    expect(h.length).toBe(2);
    expect(h.getAll()[0]!.signal).toBe("SIGTERM");
  });
});

describe("resize", () => {
  it("updates dimensions and emits events", () => {
    // Spawn a real child so SIGWINCH delivery succeeds.
    const pid = spawnShellProcess();
    pidsToCleanup.push(pid);

    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid });
    _registry.register(_record);
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();

    resize(_record, 120, 40, _registry, historyMap, bus);

    expect(_registry.get(_record.ptyId)?.dimensions).toEqual({
      cols: 120,
      rows: 40,
    });
    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.signal.delivered");
    expect(topics).toContain("pty.resized");
  });

  it("rejects zero cols", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord();
    registry.register(record);
    expect(() => resize(_record, 0, 24, _registry, new Map(), new InMemoryBusPublisher())).toThrow(
      InvalidDimensionsError
    );
  });

  it("rejects zero rows", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord();
    registry.register(record);
    expect(() => resize(_record, 80, 0, _registry, new Map(), new InMemoryBusPublisher())).toThrow(
      InvalidDimensionsError
    );
  });

  it("rejects cols > 10000", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord();
    registry.register(record);
    expect(() =>
      resize(_record, 10001, 24, _registry, new Map(), new InMemoryBusPublisher())
    ).toThrow(InvalidDimensionsError);
  });

  it("rejects non-integer dimensions", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord();
    registry.register(record);
    expect(() => resize(record, 80.5, 24, registry, new Map(), new InMemoryBusPublisher())).toThrow(
      InvalidDimensionsError
    );
  });

  it("rejects resize on errored PTY", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ state: "errored" });
    registry.register(record);
    expect(() => resize(record, 80, 24, registry, new Map(), new InMemoryBusPublisher())).toThrow(
      "Cannot resize"
    );
  });

  it("rejects resize on stopped PTY", () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ state: "stopped" });
    registry.register(record);
    expect(() => resize(record, 80, 24, registry, new Map(), new InMemoryBusPublisher())).toThrow(
      "Cannot resize"
    );
  });
});

describe("terminate", () => {
  it("terminates with SIGTERM and cleans up", async () => {
    const pid = spawnShellProcess() as number;
    pidsToCleanup.push(pid);

    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid });
    _registry.register(_record);
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
      { gracePeriodMs: 50 },
      mockIsAlive,
      mockWait
    );

    expect(registry.get(record.ptyId)).toBeUndefined();
    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.terminating");
    expect(topics).toContain("pty.stopped");
  });

  it("is idempotent on stopped PTY", async () => {
    const _record = makeRecord({ state: "stopped" });
    const lifecycle = new PtyLifecycle(record.ptyId, "stopped");
    const bus = new InMemoryBusPublisher();
    await terminate(record, lifecycle, new PtyRegistry(), new Map(), bus);
    expect(bus.events).toHaveLength(0);
  });

  it("escalates to SIGKILL after grace period", async () => {
    const _registry = new PtyRegistry();
    const _record = makeRecord({ pid: 99999 });
    registry.register(record);
    const lifecycle = new PtyLifecycle(record.ptyId, "active");
    const bus = new InMemoryBusPublisher();

    let callCount = 0;
    const mockWait = (): Promise<boolean> => {
      callCount++;
      return Promise.resolve(callCount > 1);
    };

    await terminate(
      record,
      lifecycle,
      registry,
      new Map(),
      bus,
      { gracePeriodMs: 50 },
      () => true,
      mockWait
    );

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.force_killed");
    expect(topics).toContain("pty.stopped");
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
    const _record = makeRecord({ pid: 999999 });
    const historyMap: SignalHistoryMap = new Map();
    const bus = new InMemoryBusPublisher();
    const envelope = sendSighup(record, historyMap, bus);
    expect(envelope.signal).toBe("SIGHUP");
    expect(envelope.outcome).toBe("failed");
    expect(envelope.error).toBeDefined();
    expect(historyMap.get(record.ptyId)?.length).toBe(1);
  });
});
