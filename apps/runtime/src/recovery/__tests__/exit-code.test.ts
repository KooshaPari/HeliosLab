import { Watchdog, CrashReason, type CrashEvent } from "../watchdog.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

describe("Exit Code Monitoring", () => {
  let watchdog: Watchdog;
  let tempDir: string;
  let bus: InMemoryLocalBus;
  let crashEvents: CrashEvent[] = [];

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `exit-code-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    bus = new InMemoryLocalBus();
    watchdog = new Watchdog(tempDir, bus);
    crashEvents = [];
    watchdog.onCrashDetected(event => crashEvents.push(event));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("exit code classification", () => {
    it("should not trigger crash on exit code 0 (graceful shutdown)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 0);

      expect(crashEvents.length).toBe(0);
    });

    it("should trigger crash on non-zero exit code", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 1);

      expect(crashEvents.length).toBe(1);
      expect(crashEvents[0].reason).toBe(CrashReason.EXIT_CODE);
      expect(crashEvents[0].exitCode).toBe(1);
    });

    it("should handle various non-zero exit codes", async () => {
      const codes = [1, 127, 255];
      for (const code of codes) {
        watchdog.registerProcess(`proc-${code}`, 2000 + code, 2000);
        await watchdog.handleProcessExit(`proc-${code}`, 2000 + code, code);
      }

      expect(crashEvents.length).toBe(3);
      expect(crashEvents.map(e => e.exitCode)).toEqual(codes);
    });
  });

  describe("signal classification", () => {
    it("should not trigger crash on SIGTERM (graceful termination)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGTERM");

      expect(crashEvents.length).toBe(0);
    });

    it("should trigger crash on SIGKILL (forced kill)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGKILL");

      expect(crashEvents.length).toBe(1);
      expect(crashEvents[0].reason).toBe(CrashReason.SIGNAL);
      expect(crashEvents[0].signal).toBe("SIGKILL");
    });

    it("should trigger crash on SIGSEGV (segmentation fault)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGSEGV");

      expect(crashEvents.length).toBe(1);
      expect(crashEvents[0].reason).toBe(CrashReason.SIGNAL);
      expect(crashEvents[0].signal).toBe("SIGSEGV");
    });

    it("should trigger crash on SIGBUS (bus error)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGBUS");

      expect(crashEvents.length).toBe(1);
      expect(crashEvents[0].reason).toBe(CrashReason.SIGNAL);
    });

    it("should trigger crash on SIGABRT (abort signal)", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, undefined, "SIGABRT");

      expect(crashEvents.length).toBe(1);
      expect(crashEvents[0].reason).toBe(CrashReason.SIGNAL);
    });
  });

  describe("crash record persistence", () => {
    it("should write crash record to filesystem", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 1);

      // Give async I/O time
      await new Promise(resolve => setTimeout(resolve, 100));

      const recordPath = path.join(tempDir, "recovery", "last-crash.json");
      const exists = await fs
        .access(recordPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(recordPath, "utf-8");
      const record = JSON.parse(content);
      expect(record.name).toBe("test-proc");
      expect(record.pid).toBe(1234);
      expect(record.exitCode).toBe(1);
    });

    it("should use atomic write for crash records", async () => {
      watchdog.registerProcess("proc1", 1001, 2000);
      await watchdog.handleProcessExit("proc1", 1001, 1);

      await new Promise(resolve => setTimeout(resolve, 100));

      watchdog.registerProcess("proc2", 1002, 2000);
      await watchdog.handleProcessExit("proc2", 1002, 2);

      await new Promise(resolve => setTimeout(resolve, 100));

      const recordPath = path.join(tempDir, "recovery", "last-crash.json");
      const content = await fs.readFile(recordPath, "utf-8");
      const record = JSON.parse(content);

      // Should have the most recent crash
      expect(record.pid).toBe(1002);
      expect(record.exitCode).toBe(2);
    });

    it("should handle directory creation in crash record write", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 1);

      await new Promise(resolve => setTimeout(resolve, 100));

      const recoveryDir = path.join(tempDir, "recovery");
      const exists = await fs
        .access(recoveryDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("bus event publishing", () => {
    it("should publish crash event to bus on exit code crash", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 1);

      const events = bus.getEvents();
      expect(events.length).toBeGreaterThan(0);
      const crashEvent = events.find(e => e.topic === "recovery.crash.detected");
      expect(crashEvent).toBeDefined();
      expect(crashEvent?.payload?.reason).toBe(CrashReason.EXIT_CODE);
    });

    it("should include full crash details in bus event", async () => {
      watchdog.registerProcess("test-proc", 1234, 2000);
      await watchdog.handleProcessExit("test-proc", 1234, 1);

      const events = bus.getEvents();
      const crashEvent = events.find(e => e.topic === "recovery.crash.detected");
      expect(crashEvent?.payload).toMatchObject({
        name: "test-proc",
        pid: 1234,
        exitCode: 1,
      });
    });

    it("should handle missing bus gracefully", async () => {
      const watchdogNoBus = new Watchdog(tempDir);
      const crashes: CrashEvent[] = [];
      watchdogNoBus.onCrashDetected(event => crashes.push(event));

      watchdogNoBus.registerProcess("test-proc", 1234, 2000);
      await watchdogNoBus.handleProcessExit("test-proc", 1234, 1);

      expect(crashes.length).toBe(1);

      // Should still write to filesystem
      await new Promise(resolve => setTimeout(resolve, 100));
      const recordPath = path.join(tempDir, "recovery", "last-crash.json");
      const exists = await fs
        .access(recordPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
