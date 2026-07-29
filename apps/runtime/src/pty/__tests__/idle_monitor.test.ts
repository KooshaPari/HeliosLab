import { describe, expect, it } from "bun:test";
import { IdleMonitor } from "../idle_monitor.js";
import { PtyRegistry } from "../registry.js";
import type { PtyRecord } from "../registry.js";
import { PtyLifecycle } from "../state_machine.js";
import { InMemoryBusPublisher } from "../events.js";

function makeRecord(
  registry: PtyRegistry,
  ptyId: string,
  overrides?: Partial<PtyRecord>
): PtyRecord {
  const record: PtyRecord = {
    ptyId,
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    pid: process.pid,
    state: "active",
    dimensions: { cols: 80, rows: 24 },
    createdAt: Date.now() - 400_000, // created 400s ago
    updatedAt: Date.now(),
    env: Object.freeze({}),
    ...overrides,
  };
  registry.register(record);
  return record;
}

describe("IdleMonitor", () => {
  it("transitions idle PTY to throttled", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const _record = makeRecord(registry, "pty-1");
    const lifecycle = new PtyLifecycle("pty-1", "active");
    lifecycles.set("pty-1", lifecycle);

    const monitor = new IdleMonitor(registry, bus, lifecycles, {
      defaultTimeoutMs: 100, // Very short for test.
      pollIntervalMs: 10_000,
    });

    // Don't record any output — PTY was created 400s ago.
    monitor.checkIdle();

    expect(lifecycle.state).toBe("throttled");
    expect(registry.get("pty-1")?.state).toBe("throttled");

    const topics = bus.events.map(e => e.topic);
    expect(topics).toContain("pty.idle_timeout");
    expect(topics).toContain("pty.state.changed");
  });

  it("does not throttle PTY with recent output", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const _record = makeRecord(registry, "pty-1");
    const lifecycle = new PtyLifecycle("pty-1", "active");
    lifecycles.set("pty-1", lifecycle);

    const monitor = new IdleMonitor(registry, bus, lifecycles, {
      defaultTimeoutMs: 300_000,
    });

    // Record recent output.
    monitor.recordOutput("pty-1");

    monitor.checkIdle();

    expect(lifecycle.state).toBe("active");
  });

  it("does not throttle disabled PTYs", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const _record = makeRecord(registry, "pty-1");
    const lifecycle = new PtyLifecycle("pty-1", "active");
    lifecycles.set("pty-1", lifecycle);

    const monitor = new IdleMonitor(registry, bus, lifecycles, {
      defaultTimeoutMs: 100,
    });

    monitor.disableFor("pty-1");
    monitor.checkIdle();

    expect(lifecycle.state).toBe("active");
  });

  it("transitions throttled PTY back to active on output", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const _record = makeRecord(registry, "pty-1", { state: "throttled" });
    const lifecycle = new PtyLifecycle("pty-1", "throttled");
    lifecycles.set("pty-1", lifecycle);

    const monitor = new IdleMonitor(registry, bus, lifecycles);

    monitor.recordOutput("pty-1");

    expect(lifecycle.state).toBe("active");
    expect(registry.get("pty-1")?.state).toBe("active");
  });

  it("supports per-PTY timeout override", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const _record = makeRecord(registry, "pty-1");
    const lifecycle = new PtyLifecycle("pty-1", "active");
    lifecycles.set("pty-1", lifecycle);

    const monitor = new IdleMonitor(registry, bus, lifecycles, {
      defaultTimeoutMs: 100,
    });

    // Set a very long per-PTY timeout.
    monitor.setTimeoutFor("pty-1", 999_999_999);
    monitor.checkIdle();

    expect(lifecycle.state).toBe("active");
  });

  it("remove cleans up tracking", () => {
    const _registry = new PtyRegistry();
    const bus = new InMemoryBusPublisher();
    const lifecycles = new Map<string, PtyLifecycle>();

    const monitor = new IdleMonitor(registry, bus, lifecycles);
    monitor.recordOutput("pty-1");
    monitor.disableFor("pty-1");
    monitor.setTimeoutFor("pty-1", 1000);

    monitor.remove("pty-1");
    // Should not throw.
    monitor.checkIdle();
  });
});
