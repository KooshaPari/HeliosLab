import type { LocalBus } from "../protocol/bus.js";
import { randomUUID } from "crypto";
import {
  deleteRecoveryState,
  loadRecoveryState,
  persistRecoveryState,
} from "./state-machine-persistence.js";
import {
  getFailureStateFor,
  isFailureState,
  LEGAL_TRANSITIONS,
} from "./state-machine-transitions.js";
import {
  MAX_RETRIES_PER_STAGE,
  RecoveryStage,
  STAGE_TIMEOUT_MS,
  type RecoveryState,
  type StageChangeListener,
} from "./state-machine-types.js";

export { RecoveryStage } from "./state-machine-types.js";
export type { RecoveryState } from "./state-machine-types.js";

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
    const isRetry = isFailureState(from) && isFailureState(to) === false;
    if (isRetry) {
      // Retrying - increment attempt count
      this.currentState.attemptCount++;
      if (this.currentState.attemptCount > MAX_RETRIES_PER_STAGE) {
        throw new Error(`Max retries (${MAX_RETRIES_PER_STAGE}) exceeded for stage ${from}`);
      }
    } else if (!isFailureState(to) && from !== to) {
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

  private async loadState(): Promise<void> {
    const state = await loadRecoveryState(this.recoveryDataDir);
    if (state) {
      this.currentStage = state.stage;
      this.currentState = state;
      return;
    }

    this.currentStage = RecoveryStage.CRASHED;
    this.currentState = {
      stage: RecoveryStage.CRASHED,
      timestamp: Date.now(),
      attemptCount: 0,
    };
  }

  private async persistState(): Promise<void> {
    await persistRecoveryState(this.recoveryDataDir, this.currentState);
  }

  private async deleteState(): Promise<void> {
    await deleteRecoveryState(this.recoveryDataDir);
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
      if (!isFailureState(this.currentStage)) {
        const failureStage = getFailureStateFor(this.currentStage);
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
}
