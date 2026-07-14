import type { LocalBus } from "../protocol/bus.js";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export enum RecoveryStage {
  CRASHED = "CRASHED",
  DETECTING = "DETECTING",
  INVENTORYING = "INVENTORYING",
  RESTORING = "RESTORING",
  RECONCILING = "RECONCILING",
  LIVE = "LIVE",
  DETECTION_FAILED = "DETECTION_FAILED",
  INVENTORY_FAILED = "INVENTORY_FAILED",
  RESTORATION_FAILED = "RESTORATION_FAILED",
  RECONCILIATION_FAILED = "RECONCILIATION_FAILED",
}

export interface RecoveryState {
  stage: RecoveryStage;
  timestamp: number;
  attemptCount: number;
  lastError?: string;
}

type StageChangeListener = (
  previous: RecoveryStage,
  current: RecoveryStage,
  attemptCount: number
) => void;

const LEGAL_TRANSITIONS: Record<RecoveryStage, RecoveryStage[]> = {
  [RecoveryStage.CRASHED]: [RecoveryStage.DETECTING],
  [RecoveryStage.DETECTING]: [RecoveryStage.INVENTORYING, RecoveryStage.DETECTION_FAILED],
  [RecoveryStage.INVENTORYING]: [RecoveryStage.RESTORING, RecoveryStage.INVENTORY_FAILED],
  [RecoveryStage.RESTORING]: [RecoveryStage.RECONCILING, RecoveryStage.RESTORATION_FAILED],
  [RecoveryStage.RECONCILING]: [RecoveryStage.LIVE, RecoveryStage.RECONCILIATION_FAILED],
  [RecoveryStage.LIVE]: [], // Terminal state
  [RecoveryStage.DETECTION_FAILED]: [RecoveryStage.DETECTING], // Retry
  [RecoveryStage.INVENTORY_FAILED]: [RecoveryStage.INVENTORYING],
  [RecoveryStage.RESTORATION_FAILED]: [RecoveryStage.RESTORING],
  [RecoveryStage.RECONCILIATION_FAILED]: [RecoveryStage.RECONCILING],
};

const MAX_RETRIES_PER_STAGE = 3;
const STAGE_TIMEOUT_MS = 30000; // 30 seconds

export class RecoveryStateMachine {
  private currentStage: RecoveryStage = RecoveryStage.CRASHED;
  private currentState: RecoveryState;
  private recoveryDataDir: string;
  private bus?: LocalBus;
  private listeners: StageChangeListener[] = [];
  private stageTimeoutId?: ReturnType<typeof setTimeout> | undefined;

  constructor(recoveryDataDir: string, bus?: LocalBus) {
    this.recoveryDataDir = recoveryDataDir;
    this.bus = bus;
    this.currentState = {
      stage: RecoveryStage.CRASHED,
      timestamp: Date.now(),
      attemptCount: 0,
    };
  }

  async initialize(): Promise<void> {
    await this.loadState();
  }

  getCurrentStage(): RecoveryStage {
    return this.currentStage;
  }

  async transition(to: RecoveryStage): Promise<void> {
    const from = this.currentStage;

    // Validate transition
    const legalTransitions = LEGAL_TRANSITIONS[from] || [];
    if (!legalTransitions.includes(to)) {
      throw new Error(
        `Illegal transition from ${from} to ${to}. Legal: ${legalTransitions.join(", ")}`
      );
    }

    // Update state
    const isRetry = this.isFailureState(from) && this.isFailureState(to) === false;
    if (isRetry) {
      // Retrying - increment attempt count
      this.currentState.attemptCount++;
      if (this.currentState.attemptCount > MAX_RETRIES_PER_STAGE) {
        throw new Error(`Max retries (${MAX_RETRIES_PER_STAGE}) exceeded for stage ${from}`);
      }
    } else if (from !== to) {
      // New stage - reset attempt count
      this.currentState.attemptCount = 0;
    }

    this.currentStage = to;
    this.currentState.stage = to;
    this.currentState.timestamp = Date.now();

    // Persist state
    await this.persistState();

    // Publish event
    if (this.bus) {
      await this.bus.publish({
        id: randomUUID(),
        type: "event",
        ts: new Date().toISOString(),
        topic: "recovery.stage.changed",
        payload: {
          previous: from,
          current: to,
          timestamp: this.currentState.timestamp,
          attemptCount: this.currentState.attemptCount,
        },
      });
    }

    // Notify listeners
    this.notifyListeners(from, to, this.currentState.attemptCount);

    // Set stage timeout
    this.startStageTimeout();
  }

  async resume(): Promise<RecoveryStage> {
    await this.loadState();
    return this.currentStage;
  }

  async reset(): Promise<void> {
    this.currentStage = RecoveryStage.CRASHED;
    this.currentState = {
      stage: RecoveryStage.CRASHED,
      timestamp: Date.now(),
      attemptCount: 0,
    };
    await this.deleteState();
    this.clearStageTimeout();
  }

  onStageChange(listener: StageChangeListener): void {
    this.listeners.push(listener);
  }

  private isFailureState(stage: RecoveryStage): boolean {
    return stage.includes("FAILED");
  }

  private async loadState(): Promise<void> {
    try {
      const statePath = path.join(this.recoveryDataDir, "recovery", "recovery-state.json");
      const data = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(data) as RecoveryState;
      this.currentStage = state.stage;
      this.currentState = state;
    } catch {
      // No persisted state - start fresh
      this.currentStage = RecoveryStage.CRASHED;
      this.currentState = {
        stage: RecoveryStage.CRASHED,
        timestamp: Date.now(),
        attemptCount: 0,
      };
    }
  }

  private async persistState(): Promise<void> {
    try {
      await fs.mkdir(path.join(this.recoveryDataDir, "recovery"), {
        recursive: true,
      });

      const statePath = path.join(this.recoveryDataDir, "recovery", "recovery-state.json");
      const tempPath = `${statePath}.tmp`;

      // Atomic write
      await fs.writeFile(tempPath, JSON.stringify(this.currentState, null, 2));
      await fs.rename(tempPath, statePath);
    } catch {
      console.error("Failed to persist recovery state:", err);
    }
  }

  private async deleteState(): Promise<void> {
    try {
      const statePath = path.join(this.recoveryDataDir, "recovery", "recovery-state.json");
      await fs.unlink(statePath);
    } catch {
      // File doesn't exist - ok
    }
  }

  private notifyListeners(from: RecoveryStage, to: RecoveryStage, attemptCount: number): void {
    for (const listener of this.listeners) {
      listener(from, to, attemptCount);
    }
  }

  private startStageTimeout(): void {
    this.clearStageTimeout();

    this.stageTimeoutId = setTimeout(() => {
      // Transition to failure state if not already in one
      if (!this.isFailureState(this.currentStage)) {
        const failureStage = this.getFailureStateFor(this.currentStage);
        if (failureStage) {
          this.currentState.lastError = `Stage timeout after ${STAGE_TIMEOUT_MS}ms`;
          this.transition(failureStage).catch(err => {
            console.error("Failed to transition to failure state:", err);
          });
        }
      }
    }, STAGE_TIMEOUT_MS);
  }

  private clearStageTimeout(): void {
    if (this.stageTimeoutId) {
      clearTimeout(this.stageTimeoutId);
      this.stageTimeoutId = undefined;
    }
  }

  private getFailureStateFor(stage: RecoveryStage): RecoveryStage | undefined {
    const failureMap: Record<RecoveryStage, RecoveryStage | undefined> = {
      [RecoveryStage.DETECTING]: RecoveryStage.DETECTION_FAILED,
      [RecoveryStage.INVENTORYING]: RecoveryStage.INVENTORY_FAILED,
      [RecoveryStage.RESTORING]: RecoveryStage.RESTORATION_FAILED,
      [RecoveryStage.RECONCILING]: RecoveryStage.RECONCILIATION_FAILED,
      [RecoveryStage.CRASHED]: RecoveryStage.CRASHED,
      [RecoveryStage.LIVE]: undefined,
      [RecoveryStage.DETECTION_FAILED]: undefined,
      [RecoveryStage.INVENTORY_FAILED]: undefined,
      [RecoveryStage.RESTORATION_FAILED]: undefined,
      [RecoveryStage.RECONCILIATION_FAILED]: undefined,
    };
    return failureMap[stage];
  }
}
