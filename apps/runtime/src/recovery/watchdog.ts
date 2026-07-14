import type { LocalBus } from "../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export enum CrashReason {
  HEARTBEAT_TIMEOUT = "HEARTBEAT_TIMEOUT",
  UNRESPONSIVE = "UNRESPONSIVE",
  EXIT_CODE = "EXIT_CODE",
  SIGNAL = "SIGNAL",
}

export interface CrashEvent {
  name: string;
  pid: number;
  reason: CrashReason;
  exitCode?: number;
  signal?: string;
  timestamp: number;
}

type CrashHandler = (event: CrashEvent) => void;

interface ProcessMonitor {
  name: string;
  pid: number;
  heartbeatIntervalMs: number;
  lastHeartbeat: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class Watchdog {
  private monitors = new Map<string, ProcessMonitor>();
  private crashHandlers: CrashHandler[] = [];
  private crashDataDir: string;
  private bus?: LocalBus;

  constructor(crashDataDir: string, bus?: LocalBus) {
    this.crashDataDir = crashDataDir;
    this.bus = bus;
  }

  registerProcess(name: string, pid: number, heartbeatIntervalMs: number = 2000): void {
    // Clear any existing monitor for this name
    this.unregister(name);

    const monitor: ProcessMonitor = {
      name,
      pid,
      heartbeatIntervalMs,
      lastHeartbeat: Date.now(),
    };

    this.monitors.set(name, monitor);
    this.startHeartbeatTimer(monitor);
  }

  receiveHeartbeat(name: string): void {
    const monitor = this.monitors.get(name);
    if (!monitor) return;

    monitor.lastHeartbeat = Date.now();
    // Reset timeout
    if (monitor.timeoutId) clearTimeout(monitor.timeoutId);
    this.startHeartbeatTimer(monitor);
  }

  unregister(name: string): void {
    const monitor = this.monitors.get(name);
    if (monitor && monitor.timeoutId) {
      clearTimeout(monitor.timeoutId);
    }
    this.monitors.delete(name);
  }

  onCrashDetected(callback: CrashHandler): void {
    this.crashHandlers.push(callback);
  }

  private startHeartbeatTimer(monitor: ProcessMonitor): void {
    const timeoutMs = monitor.heartbeatIntervalMs * 2; // 2 missed heartbeats
    monitor.timeoutId = setTimeout(() => {
      this.handleHeartbeatTimeout(monitor);
    }, timeoutMs);
  }

  private async handleHeartbeatTimeout(monitor: ProcessMonitor): Promise<void> {
    // Check if process is still running
    const isRunning = await this.isProcessRunning(monitor.pid);

    let reason = CrashReason.UNRESPONSIVE;
    if (!isRunning) {
      reason = CrashReason.HEARTBEAT_TIMEOUT;
    }

    const crashEvent: CrashEvent = {
      name: monitor.name,
      pid: monitor.pid,
      reason,
      timestamp: Date.now(),
    };

    await this.handleCrash(crashEvent);
  }

  async handleProcessExit(
    name: string,
    pid: number,
    exitCode?: number,
    signal?: string
  ): Promise<void> {
    this.unregister(name);

    // Classify exit
    let reason = CrashReason.EXIT_CODE;
    if (signal) {
      if (signal === "SIGTERM") {
        // Graceful termination - no recovery needed
        return;
      }
      reason = CrashReason.SIGNAL;
    } else if (exitCode === 0) {
      // Graceful shutdown - no recovery needed
      return;
    }

    const crashEvent: CrashEvent = {
      name,
      pid,
      reason,
      exitCode,
      signal,
      timestamp: Date.now(),
    };

    await this.handleCrash(crashEvent);
  }

  private async handleCrash(event: CrashEvent): Promise<void> {
    // Write crash record to filesystem
    await this.writeCrashRecord(event);

    // Publish bus event if available
    if (this.bus) {
      await this.bus.publish({
        id: randomUUID(),
        type: "event",
        ts: new Date().toISOString(),
        topic: "recovery.crash.detected",
        payload: {
          name: event.name,
          pid: event.pid,
          reason: event.reason,
          exitCode: event.exitCode,
          signal: event.signal,
          timestamp: event.timestamp,
        },
      });
    }

    // Invoke crash handlers
    for (const handler of this.crashHandlers) {
      handler(event);
    }
  }

  private async writeCrashRecord(event: CrashEvent): Promise<void> {
    try {
      await fs.mkdir(path.join(this.crashDataDir, "recovery"), {
        recursive: true,
      });

      const recordPath = path.join(this.crashDataDir, "recovery", "last-crash.json");
      const tempPath = `${recordPath}.tmp`;

      // Atomic write: write to temp file then rename
      await fs.writeFile(tempPath, JSON.stringify(event, null, 2));
      await fs.rename(tempPath, recordPath);
    } catch {
      // Silently fail - watchdog should not crash due to I/O errors
      console.error("Failed to write crash record:", err);
    }
  }

  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      // Try to send signal 0 (no-op kill) to check if process exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export function startHeartbeat(
  watchdog: Watchdog,
  processName: string,
  intervalMs: number = 2000
): () => void {
  let running = true;
  const interval = setInterval(() => {
    if (running) {
      watchdog.receiveHeartbeat(processName);
    }
  }, intervalMs);

  return () => {
    running = false;
    clearInterval(interval);
  };
}
