import { SafeMode, CrashLoopDetector, type SafeModeConfig } from "../safe-mode.js";
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

    // Create new detector instance and load history
    await new Promise(resolve => setTimeout(resolve, 50));
    const detector2 = new CrashLoopDetector(tempDir, 3, 60000);
    await detector2.initialize();

    detector2.recordCrash(now + 2000);
    expect(detector2.isLooping()).toBe(true);
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
    bus.getEvents().length = 0; // Clear events
    await safeMode.exit();
    const events = bus.getEvents();
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
