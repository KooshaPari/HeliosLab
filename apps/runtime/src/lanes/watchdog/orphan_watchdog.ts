// T001 - Orphan watchdog scheduler with checkpoint persistence

import { CheckpointManager, type WatchdogCheckpoint } from "./checkpoint.js";
import { ResourceClassifier, type ClassifiedOrphan } from "./resource_classifier.js";
import { WorktreeDetector } from "./worktree_detector.js";
import { ZellijDetector, type SessionRegistry } from "./zellij_detector.js";
import { PtyDetector, type TerminalRegistry } from "./pty_detector.js";
import type { LocalBus } from "../../protocol/bus.js";
import type { LaneRegistry } from "../registry.js";

export interface WatchdogConfig {
  detectionInterval: number; // milliseconds
  worktreeBaseDir: string;
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
  laneRegistry: LaneRegistry;
  bus: LocalBus;
  checkpointBaseDir?: string;
}

export interface WatchdogSuggestion {
  lane_id?: string;
  session_id?: string;
  resource_id?: string;
  risk_level: number;
  action: "decline" | "ignore";
  reason: string;
  event: {
    type: "decline" | "ignore";
    timestamp: string;
  };
}

export class OrphanWatchdog {
  private readonly checkpointManager: CheckpointManager;
  private readonly resourceClassifier = new ResourceClassifier();
  private readonly worktreeDetector: WorktreeDetector;
  private readonly zellijDetector: ZellijDetector;
  private readonly ptyDetector: PtyDetector;

  private readonly detectionInterval: number;
  private readonly bus: LocalBus;
  private cycleNumber = 0;
  private isRunning = false;
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDetectionDuration = 0;
  private lastClassifiedOrphans: ClassifiedOrphan[] = [];

  constructor(config: WatchdogConfig) {
    this.checkpointManager = new CheckpointManager(config.checkpointBaseDir);
    this.detectionInterval = config.detectionInterval || 60000;
    this.bus = config.bus;

    this.worktreeDetector = new WorktreeDetector(config.worktreeBaseDir, config.laneRegistry);
    this.zellijDetector = new ZellijDetector(config.sessionRegistry);
    this.ptyDetector = new PtyDetector(config.terminalRegistry);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("Watchdog is already running");
      return;
    }

    this.isRunning = true;

    // Load checkpoint for crash recovery
    const checkpoint = await this.checkpointManager.load();
    if (checkpoint) {
      this.cycleNumber = checkpoint.cycleNumber;
      console.log(
        `[Watchdog] Resumed from checkpoint: cycle ${this.cycleNumber}, last run: ${checkpoint.lastCycleTimestamp}`
      );
    } else {
      console.log("[Watchdog] Starting fresh with no checkpoint");
    }

    console.log(`[Watchdog] Started with ${this.detectionInterval}ms interval`);

    // Run first cycle immediately
    this.scheduleNextCycle();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
      this.detectionTimer = null;
    }

    console.log("[Watchdog] Stopped");
  }

  getLastDetectionDuration(): number {
    return this.lastDetectionDuration;
  }

  getLastClassifiedOrphans(): ClassifiedOrphan[] {
    return [...this.lastClassifiedOrphans];
  }

  private scheduleNextCycle(): void {
    this.detectionTimer = setTimeout(async () => {
      await this.processOrphans();
      if (this.isRunning) {
        this.scheduleNextCycle();
      }
    }, this.detectionInterval);
  }

  private async processOrphans(): Promise<void> {
    if (!this.isRunning) return;

    const startTime = Date.now();

    try {
      // Run all three detectors in parallel (allSettled tolerates individual failures)
      const results = await Promise.allSettled([
        this.worktreeDetector.detect(),
        this.zellijDetector.detect(),
        this.ptyDetector.detect(),
      ]);

      const worktreeOrphans = results[0].status === "fulfilled" ? results[0].value : [];
      const zellijOrphans = results[1].status === "fulfilled" ? results[1].value : [];
      const ptyOrphans = results[2].status === "fulfilled" ? results[2].value : [];
      const allOrphans = [...worktreeOrphans, ...zellijOrphans, ...ptyOrphans];

      // Classify all orphans
      this.lastClassifiedOrphans = this.resourceClassifier.classifyAll(allOrphans);

      // Record detection duration
      this.lastDetectionDuration = Date.now() - startTime;

      // Warn if cycle took too long
      if (this.lastDetectionDuration > 2000) {
        // biome-ignore lint/suspicious/noConsole: High-latency detection cycles are intentionally surfaced for triage.
        console.warn(
          `[Watchdog] Detection cycle took ${this.lastDetectionDuration}ms (exceeds 2s target)`
        );
      }

      // Increment cycle number before emitting events so first cycle is cycle 1
      this.cycleNumber++;

      // Emit detection cycle event
      await this.bus.publish({
        id: `orphan-cycle-${this.cycleNumber}`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "orphan.detection.cycle_completed",
        payload: {
          cycleNumber: this.cycleNumber,
          duration: this.lastDetectionDuration,
          orphanCount: this.lastClassifiedOrphans.length,
          summary: {
            worktrees: worktreeOrphans.length,
            zellijSessions: zellijOrphans.length,
            ptyProcesses: ptyOrphans.length,
          },
        },
      });

      // Emit individual resource events
      for (const orphan of this.lastClassifiedOrphans) {
        await this.bus.publish({
          id: `orphan-${this.cycleNumber}-${orphan.path || orphan.pid}`,
          type: "event",
          ts: new Date().toISOString(),
          topic: "orphan.detection.resource_found",
          payload: {
            cycleNumber: this.cycleNumber,
            resource: orphan,
          },
        });
      }

      // Emit watchdog.suggestion events for high-risk orphans
      const highRisk = this.lastClassifiedOrphans.filter(o => o.riskLevel === "high");
      for (const orphan of highRisk) {
        const riskLevelMap = { low: 1, medium: 2, high: 3 };
        const suggestion: WatchdogSuggestion = {
          risk_level: riskLevelMap[orphan.riskLevel],
          action: "decline",
          reason: `Orphan resource detected: ${orphan.type} (risk ${orphan.riskLevel})`,
          event: {
            type: "decline",
            timestamp: new Date().toISOString(),
          },
        };
        await this.bus.publish({
          id: `suggestion-${this.cycleNumber}-${orphan.path ?? orphan.pid ?? orphan.type}`,
          type: "event",
          ts: new Date().toISOString(),
          topic: "watchdog.suggestion",
          payload: {
            suggestion,
            orphan,
          },
        });
      }

      // Save checkpoint
      const checkpoint: WatchdogCheckpoint = {
        cycleNumber: this.cycleNumber,
        lastCycleTimestamp: new Date().toISOString(),
        orphanCount: this.lastClassifiedOrphans.length,
        detectionSummary: {
          worktrees: worktreeOrphans.length,
          zellijSessions: zellijOrphans.length,
          ptyProcesses: ptyOrphans.length,
        },
      };
      await this.checkpointManager.save(checkpoint);

      console.log(
        `[Watchdog] Cycle ${this.cycleNumber} completed: ${this.lastDetectionDuration}ms, ${this.lastClassifiedOrphans.length} orphans found`
      );
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: Checkpoint save failures are intentionally emitted for operational visibility.
      console.error("Orphan watchdog detection cycle failed", error);
    }
  }
}
