/** Minimal subset of runtime LocalBus used for context events. */
interface LocalBus {
  publish(event: Record<string, unknown>): Promise<void>;
}

export interface ActiveContext {
  workspaceId: string;
  laneId: string;
  sessionId: string;
}

export interface ContextChangeEvent {
  previous: ActiveContext | null;
  current: ActiveContext | null;
}

export interface ContextValidationResult {
  valid: boolean;
  error?: string;
}

type ContextChangeListener = (event: ContextChangeEvent) => void;

/**
 * ActiveContextStore provides a single source of truth for the current
 * workspace/lane/session context. All tabs bind to this store and update
 * atomically on context changes.
 *
 * Design:
 * - Debounces rapid context changes (50ms) to prevent intermediate renders.
 * - Validates contexts before accepting to ensure consistency.
 * - Emits events on the internal bus for context changes and validation failures.
 */
export class ActiveContextStore {
  private currentContext: ActiveContext | null = null;
  private listeners = new Set<ContextChangeListener>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingContext: ActiveContext | null = null;
  private bus: LocalBus | null = null;
  private validator: ((ctx: ActiveContext) => Promise<boolean>) | null = null;

  constructor(bus?: LocalBus) {
    this.bus = bus ?? null;
  }

  /**
   * Set the context validator function. Called before accepting a new context.
   */
  setValidator(validator: (ctx: ActiveContext) => Promise<boolean>): void {
    this.validator = validator;
  }

  /**
   * Get the current active context.
   */
  getContext(): ActiveContext | null {
    return this.currentContext;
  }

  /**
   * Set a new active context. Validates the context and emits a change event.
   * Debounces rapid calls to only emit the final context.
   */
  async setContext(context: ActiveContext | null): Promise<void> {
    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.pendingContext = context;

    // Debounce: wait 50ms for any additional changes before committing
    return new Promise(resolve => {
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;

        const contextToSet = this.pendingContext;
        this.pendingContext = null;

        // Validate context if validator is set
        if (contextToSet !== null && this.validator) {
          const isValid = await this.validator(contextToSet);
          if (!isValid) {
            // Emit validation failure event
            if (this.bus) {
              await this.bus.publish({
                id: `validation-${Date.now()}`,
                type: "event",
                ts: new Date().toISOString(),
                topic: "context.validation.failed",
                payload: { context: contextToSet },
              });
            }
            resolve();
            return;
          }
        }

        // Store previous context for comparison
        const previousContext = this.currentContext;

        // Update context
        this.currentContext = contextToSet;

        // Emit change event to listeners
        const changeEvent: ContextChangeEvent = {
          previous: previousContext,
          current: this.currentContext,
        };

        for (const listener of this.listeners) {
          listener(changeEvent);
        }

        // Publish to bus
        if (this.bus) {
          await this.bus.publish({
            id: `context-change-${Date.now()}`,
            type: "event",
            ts: new Date().toISOString(),
            topic: "context.active.changed",
            workspace_id: contextToSet?.workspaceId,
            lane_id: contextToSet?.laneId,
            session_id: contextToSet?.sessionId,
            payload: changeEvent,
          });
        }

        resolve();
      }, 50);
    });
  }

  /**
   * Clear the current context (set to null).
   */
  async clearContext(): Promise<void> {
    await this.setContext(null);
  }

  /**
   * Register a listener for context change events.
   * Returns an unsubscribe function.
   */
  onContextChange(callback: ContextChangeListener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get the number of registered listeners (useful for testing).
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Global singleton instance.
 */
let globalContextStore: ActiveContextStore | null = null;

/**
 * Get the global singleton instance.
 */
export function getActiveContextStore(bus?: LocalBus): ActiveContextStore {
  if (!globalContextStore) {
    globalContextStore = new ActiveContextStore(bus);
  }
  return globalContextStore;
}

/**
 * Reset the global singleton (for testing).
 */
export function resetActiveContextStore(): void {
  globalContextStore = null;
}
