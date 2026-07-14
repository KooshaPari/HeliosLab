import { Watchdog, CrashReason, type CrashEvent } from "../watchdog.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Traces to: FR-ORF-001 (orphan detection watchdog)
describe("Watchdog", () => {
  let watchdog: Watchdog;
  let tempDir: string;
  let bus: InMemoryLocalBus;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `watchdog-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    bus = new InMemoryLocalBus();
    watchdog = new Watchdog(tempDir, bus);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // Cleanup temp dir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should detect heartbeat timeout when no heartbeat received", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    vi.advanceTimersByTime(4100); // 2 * 2000 + 100ms

    expect(crashEvents.length).toBe(1);
    expect(crashEvents[0].reason).toBe(CrashReason.HEARTBEAT_TIMEOUT);
    expect(crashEvents[0].name).toBe("test-proc");
    expect(crashEvents[0].pid).toBe(1234);
  });

  it("should reset timeout on heartbeat", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    vi.advanceTimersByTime(3000);
    watchdog.receiveHeartbeat("test-proc");
    vi.advanceTimersByTime(3000);

    expect(crashEvents.length).toBe(0);
  });

  it("should unregister clears timers", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    watchdog.unregister("test-proc");
    vi.advanceTimersByTime(4100);

    expect(crashEvents.length).toBe(0);
  });

  it("should invoke crash handler with correct reason", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 1000);
    vi.advanceTimersByTime(2100);

    expect(crashEvents.length).toBe(1);
    expect(crashEvents[0].reason).toBeDefined();
  });

  it("should publish crash event to bus", async () => {
    watchdog.registerProcess("test-proc", 1234, 1000);
    vi.advanceTimersByTime(2100);

    const events = bus.getEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].topic).toBe("recovery.crash.detected");
    expect(events[0].payload?.name).toBe("test-proc");
  });

  it("should write crash record to filesystem", async () => {
    watchdog.registerProcess("test-proc", 1234, 1000);
    vi.advanceTimersByTime(2100);
    vi.runAllTimers();

    // Give async operations time to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const recordPath = path.join(tempDir, "recovery", "last-crash.json");
    const exists = await fs
      .access(recordPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("should handle process exit with exit code", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    await watchdog.handleProcessExit("test-proc", 1234, 1);

    expect(crashEvents.length).toBe(1);
    expect(crashEvents[0].reason).toBe(CrashReason.EXIT_CODE);
    expect(crashEvents[0].exitCode).toBe(1);
  });

  it("should not trigger crash on graceful exit code 0", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    await watchdog.handleProcessExit("test-proc", 1234, 0);

    expect(crashEvents.length).toBe(0);
  });

  it("should not trigger crash on SIGTERM", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGTERM");

    expect(crashEvents.length).toBe(0);
  });

  it("should trigger crash on SIGKILL", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("test-proc", 1234, 2000);
    await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGKILL");

    expect(crashEvents.length).toBe(1);
    expect(crashEvents[0].reason).toBe(CrashReason.SIGNAL);
  });

  it("should handle multiple process monitoring", async () => {
    const crashEvents: CrashEvent[] = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));

    watchdog.registerProcess("proc1", 1001, 2000);
    watchdog.registerProcess("proc2", 1002, 2000);

    vi.advanceTimersByTime(4100);

    expect(crashEvents.length).toBe(2);
    expect(crashEvents.map(e => e.name)).toContain("proc1");
    expect(crashEvents.map(e => e.name)).toContain("proc2");
  });
});
