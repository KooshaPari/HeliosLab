/**
 * Lane Actions Module
 * Handles CRUD operations for lanes with optimistic UI updates
 */

export interface LaneActionError {
  code: string;
  message: string;
  laneId?: string;
}

export type ActionCallback = (error?: LaneActionError) => void;

export interface LaneActionsOptions {
  runtimeAPI: RuntimeAPI;
  onLaneCreated?: (laneId: string) => void;
  onLaneAttached?: (laneId: string) => void;
  onLaneDetached?: (laneId: string) => void;
  onLaneCleaned?: (laneId: string) => void;
  onError?: (error: LaneActionError) => void;
  errorDismissTimeout?: number;
}

export interface RuntimeAPI {
  createLane(workspaceId: string): Promise<{ id: string; name: string }>;
  attachLane(laneId: string): Promise<void>;
  detachLane(laneId: string): Promise<void>;
  cleanupLane(laneId: string): Promise<void>;
}

export class LaneActions {
  private options: LaneActionsOptions;
  private pendingActions: Map<string, ActionCallback> = new Map();
  private errorTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options: LaneActionsOptions) {
    this.options = {
      errorDismissTimeout: 10000,
      ...options,
    };
  }

  async createLane(workspaceId: string, onOptimistic?: ActionCallback): Promise<void> {
    try {
      // Optimistic update
      if (onOptimistic) {
        onOptimistic();
      }

      // Call runtime API
      const result = await this.options.runtimeAPI.createLane(workspaceId);

      if (this.options.onLaneCreated) {
        this.options.onLaneCreated(result.id);
      }
    } catch (error) {
      this.handleActionError("CREATE_FAILED", error, onOptimistic);
    }
  }

  async attachLane(laneId: string, onOptimistic?: ActionCallback): Promise<void> {
    try {
      // Optimistic update
      if (onOptimistic) {
        onOptimistic();
      }

      // Call runtime API
      await this.options.runtimeAPI.attachLane(laneId);

      if (this.options.onLaneAttached) {
        this.options.onLaneAttached(laneId);
      }
    } catch (error) {
      this.handleActionError("ATTACH_FAILED", error, onOptimistic);
    }
  }

  async detachLane(laneId: string, onOptimistic?: ActionCallback): Promise<void> {
    try {
      // Optimistic update
      if (onOptimistic) {
        onOptimistic();
      }

      // Call runtime API
      await this.options.runtimeAPI.detachLane(laneId);

      if (this.options.onLaneDetached) {
        this.options.onLaneDetached(laneId);
      }
    } catch (error) {
      this.handleActionError("DETACH_FAILED", error, onOptimistic);
    }
  }

  async cleanupLane(laneId: string, requireConfirmation: boolean = true): Promise<boolean> {
    if (requireConfirmation) {
      // Confirmation must be handled by caller
      // This method assumes confirmation has been obtained
      return await this.executeCleanup(laneId);
    }

    return await this.executeCleanup(laneId);
  }

  private async executeCleanup(laneId: string): Promise<boolean> {
    try {
      await this.options.runtimeAPI.cleanupLane(laneId);

      if (this.options.onLaneCleaned) {
        this.options.onLaneCleaned(laneId);
      }

      return true;
    } catch (error) {
      this.handleActionError("CLEANUP_FAILED", error);
      return false;
    }
  }

  private handleActionError(code: string, error: any, revertFn?: ActionCallback): void {
    const message = error instanceof Error ? error.message : String(error);
    const actionError: LaneActionError = {
      code,
      message: `Action failed: ${message}`,
    };

    if (revertFn) {
      revertFn();
    }

    if (this.options.onError) {
      this.options.onError(actionError);
    }

    // Auto-dismiss error after timeout
    const timeout = setTimeout(() => {
      this.errorTimeouts.delete(actionError.code);
    }, this.options.errorDismissTimeout);

    this.errorTimeouts.set(actionError.code, timeout);
  }

  dismissError(code: string): void {
    const timeout = this.errorTimeouts.get(code);
    if (timeout) {
      clearTimeout(timeout);
      this.errorTimeouts.delete(code);
    }
  }

  clearAllErrors(): void {
    this.errorTimeouts.forEach(timeout => clearTimeout(timeout));
    this.errorTimeouts.clear();
  }

  destroy(): void {
    this.clearAllErrors();
    this.pendingActions.clear();
  }
}

export function createLaneActions(options: LaneActionsOptions): LaneActions {
  return new LaneActions(options);
}
