import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalBus } from "../protocol/bus.js";

export interface CrashRecord {
  timestamp: number;
}

function isValidCrashTimestamp(value: unknown, now: number, windowMs: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= now + windowMs
  );
}

export class CrashLoopDetector {
  private crashHistory: number[] = [];
  private crashDataDir: string;
  private thresholdCount: number;
  private windowMs: number;

  constructor(crashDataDir: string, thresholdCount: number = 3, windowMs: number = 60000) {
    this.crashDataDir = crashDataDir;
    this.thresholdCount = thresholdCount;
    this.windowMs = windowMs;
  }

  async initialize(): Promise<void> {
    await this.loadCrashHistory();
  }

  async recordCrash(timestamp: number): Promise<void> {
    if (!isValidCrashTimestamp(timestamp, Date.now(), this.windowMs)) return;

    this.crashHistory.push(timestamp);
    this.cleanOldCrashes();
    await this.persistCrashHistory();
  }

  isLooping(): boolean {
    this.cleanOldCrashes();
    return this.crashHistory.length >= this.thresholdCount;
  }

  private cleanOldCrashes(): void {
    const now = Date.now();
    this.crashHistory = this.crashHistory.filter(ts => now - ts < this.windowMs);
  }

  private async loadCrashHistory(): Promise<void> {
    try {
      const historyPath = path.join(this.crashDataDir, "recovery", "crash-history.json");
      const data = await fs.readFile(historyPath, "utf-8");
      const parsed: unknown = JSON.parse(data);
      if (
        Array.isArray(parsed) &&
        parsed.every(timestamp => isValidCrashTimestamp(timestamp, Date.now(), this.windowMs))
      ) {
        this.crashHistory = parsed;
        this.cleanOldCrashes();
      } else {
        this.crashHistory = [];
      }
    } catch {
      // History file doesn't exist or is corrupted - start with empty history
      this.crashHistory = [];
    }
  }

  private async persistCrashHistory(): Promise<void> {
    const historyPath = path.join(this.crashDataDir, "recovery", "crash-history.json");
    const tempPath = `${historyPath}.${randomUUID()}.tmp`;
    try {
      // Atomic write
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(this.crashHistory), {
        encoding: "utf-8",
      });
      await fs.rename(tempPath, historyPath);
    } catch (err) {
      // Silently fail - don't let history persistence block operations
      console.error("Failed to persist crash history:", err);
    } finally {
      await fs.unlink(tempPath).catch(() => {
        // The rename consumed the temp file, or cleanup is best-effort after failure.
      });
    }
  }
}

export interface SafeModeConfig {
  disableProviders?: boolean;
  disableShareSessions?: boolean;
  disableBackgroundCheckpoints?: boolean;
}

type SafeModeChangeListener = (active: boolean) => void;

export class SafeMode {
  private active = false;
  private bus?: LocalBus;
  private listeners: SafeModeChangeListener[] = [];
  private config: SafeModeConfig;

  constructor(bus?: LocalBus, config: SafeModeConfig = {}) {
    this.bus = bus;
    this.config = {
      disableProviders: config.disableProviders !== false,
      disableShareSessions: config.disableShareSessions !== false,
      disableBackgroundCheckpoints: config.disableBackgroundCheckpoints !== false,
    };
  }

  async enter(): Promise<void> {
    if (this.active) return;

    this.active = true;

    // Publish event
    if (this.bus) {
      await this.bus.publish({
        id: randomUUID(),
        type: "event",
        ts: new Date().toISOString(),
        topic: "recovery.safemode.entered",
        payload: {
          timestamp: Date.now(),
          config: this.config,
        },
      });
    }

    // Notify listeners
    this.notifyListeners(true);
  }

  async exit(): Promise<void> {
    if (!this.active) return;

    this.active = false;

    // Publish event
    if (this.bus) {
      await this.bus.publish({
        id: randomUUID(),
        type: "event",
        ts: new Date().toISOString(),
        topic: "recovery.safemode.exited",
        payload: {
          timestamp: Date.now(),
        },
      });
    }

    // Notify listeners
    this.notifyListeners(false);
  }

  isActive(): boolean {
    return this.active;
  }

  onStateChange(listener: SafeModeChangeListener): void {
    this.listeners.push(listener);
  }

  private notifyListeners(active: boolean): void {
    for (const listener of this.listeners) {
      listener(active);
    }
  }

  // Query methods for subsystems to check if they should be active
  isProvidersEnabled(): boolean {
    return !this.active || !this.config.disableProviders;
  }

  isShareSessionsEnabled(): boolean {
    return !this.active || !this.config.disableShareSessions;
  }

  isBackgroundCheckpointsEnabled(): boolean {
    return !this.active || !this.config.disableBackgroundCheckpoints;
  }
}
