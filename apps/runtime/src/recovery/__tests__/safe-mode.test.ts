import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { SafeMode, CrashLoopDetector, type SafeModeConfig } from "../safe-mode.js";
import { Watchdog } from "../watchdog.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Traces to: FR-CRH-009 (crash loop detection and safe mode)
describe("CrashLoopDetector", () => {
  let detector: CrashLoopDetector;
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `crash-loop-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    detector = new CrashLoopDetector(tempDir, 3, 60000);
    await detector.initialize();
  });

  afterEach(async () => {
    await detector.flush();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should not detect loop with fewer than threshold crashes", () => {
    const now = Date.now();
    detector.recordCrash(now);
    detector.recordCrash(now + 1000);

    expect(detector.isLooping()).toBe(false);
  });

  it("should detect loop with 3 crashes in 60s window", () => {
    const now = Date.now();
    detector.recordCrash(now);
    detector.recordCrash(now + 1000);
    detector.recordCrash(now + 2000);

    expect(detector.isLooping()).toBe(true);
  });

  it("should not detect loop with crashes outside window", () => {
    const now = Date.now();
    detector.recordCrash(now);
    detector.recordCrash(now + 1000);
    vi.advanceTimersByTime(61000); // Advance past window
    detector.recordCrash(now + 62000);

    expect(detector.isLooping()).toBe(false);
  });

  it("should persist and restore crash history", async () => {
    const now = Date.now();
    detector.recordCrash(now);
    detector.recordCrash(now + 1000);
    await detector.flush();

    // Create new detector instance and load history
    const detector2 = new CrashLoopDetector(tempDir, 3, 60000);
    await detector2.initialize();

    detector2.recordCrash(now + 2000);
    expect(detector2.isLooping()).toBe(true);
    await detector2.flush();
  });

  it("should handle corrupted history file gracefully", async () => {
    const historyPath = path.join(tempDir, "recovery", "crash-history.json");
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(historyPath, "invalid json");

    const detector2 = new CrashLoopDetector(tempDir, 3, 60000);
    await detector2.initialize();

    const now = Date.now();
    detector2.recordCrash(now);
    expect(detector2.isLooping()).toBe(false);
    await detector2.flush();
  });
});

describe("SafeMode", () => {
  let safeMode: SafeMode;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new InMemoryLocalBus();
    safeMode = new SafeMode(bus);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should start inactive", () => {
    expect(safeMode.isActive()).toBe(false);
  });

  it("should enter safe mode", async () => {
    await safeMode.enter();
    expect(safeMode.isActive()).toBe(true);
  });

  it("should exit safe mode", async () => {
    await safeMode.enter();
    await safeMode.exit();
    expect(safeMode.isActive()).toBe(false);
  });

  it("should publish enter event to bus", async () => {
    await safeMode.enter();
    const events = bus.getEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].topic).toBe("recovery.safemode.entered");
  });

  it("should publish exit event to bus", async () => {
    await safeMode.enter();
    const beforeExit = bus.getEvents().length;
    await safeMode.exit();
    const events = bus.getEvents().slice(beforeExit);
    expect(events.length).toBe(1);
    expect(events[0].topic).toBe("recovery.safemode.exited");
  });

  it("should notify state change listeners", async () => {
    const states: boolean[] = [];
    safeMode.onStateChange(active => states.push(active));

    await safeMode.enter();
    await safeMode.exit();

    expect(states).toEqual([true, false]);
  });

  it("should report subsystem status based on config", async () => {
    const config: SafeModeConfig = {
      disableProviders: true,
      disableShareSessions: false,
      disableBackgroundCheckpoints: true,
    };
    safeMode = new SafeMode(bus, config);

    expect(safeMode.isProvidersEnabled()).toBe(true);
    expect(safeMode.isShareSessionsEnabled()).toBe(true);
    expect(safeMode.isBackgroundCheckpointsEnabled()).toBe(true);

    await safeMode.enter();

    expect(safeMode.isProvidersEnabled()).toBe(false);
    expect(safeMode.isShareSessionsEnabled()).toBe(true);
    expect(safeMode.isBackgroundCheckpointsEnabled()).toBe(false);
  });

  it("should not trigger duplicate enter events", async () => {
    await safeMode.enter();
    const count1 = bus.getEvents().length;
    await safeMode.enter();
    const count2 = bus.getEvents().length;
    expect(count2).toBe(count1); // No new event
  });

  it("should not trigger duplicate exit events", async () => {
    await safeMode.enter();
    await safeMode.exit();
    const count1 = bus.getEvents().length;
    await safeMode.exit();
    const count2 = bus.getEvents().length;
    expect(count2).toBe(count1); // No new event
  });

  it("should work without bus", async () => {
    const safeModeNoBus = new SafeMode();
    const states: boolean[] = [];
    safeModeNoBus.onStateChange(active => states.push(active));

    await safeModeNoBus.enter();
    await safeModeNoBus.exit();

    expect(states).toEqual([true, false]);
  });
});

describe("Watchdog crash-loop protection (FR-CRH-009)", () => {
  let tempDir: string;
  let bus: InMemoryLocalBus;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `watchdog-safe-mode-test-${crypto.randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    bus = new InMemoryLocalBus();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("enters safe mode on the third abnormal exit within 60 seconds", async () => {
    const watchdog = new Watchdog(tempDir, bus);

    await watchdog.handleProcessExit("runtime-1", 1001, 1);
    vi.advanceTimersByTime(20_000);
    await watchdog.handleProcessExit("runtime-2", 1002, 1);

    expect(watchdog.isSafeModeActive()).toBe(false);

    vi.advanceTimersByTime(39_000);
    const thirdCrashAt = performance.now();
    await watchdog.handleProcessExit("runtime-3", 1003, 1);

    expect(watchdog.isSafeModeActive()).toBe(true);
    expect(performance.now() - thirdCrashAt).toBeLessThanOrEqual(5_000);
    expect(bus.getEvents().some(event => event.topic === "recovery.safemode.entered")).toBe(true);
    await watchdog.exitSafeMode();
    expect(watchdog.isSafeModeActive()).toBe(false);
    expect(bus.getEvents().some(event => event.topic === "recovery.safemode.exited")).toBe(true);
    await watchdog.dispose();
  });

  it("restores flushed crash history and enters safe mode after restart", async () => {
    const firstWatchdog = new Watchdog(tempDir, bus);
    await firstWatchdog.handleProcessExit("runtime-1", 2001, 1);
    await firstWatchdog.handleProcessExit("runtime-2", 2002, 1);
    await firstWatchdog.flush();

    expect(firstWatchdog.isSafeModeActive()).toBe(false);
    await firstWatchdog.dispose();

    const restartedWatchdog = new Watchdog(tempDir, bus);
    await restartedWatchdog.handleProcessExit("runtime-3", 2003, 1);

    expect(restartedWatchdog.isSafeModeActive()).toBe(true);
    await restartedWatchdog.dispose();
  });
});
