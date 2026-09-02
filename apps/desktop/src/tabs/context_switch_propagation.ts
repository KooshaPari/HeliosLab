import type { TabSurface } from "./tab_surface";
import type { ActiveContext } from "./context_switch";

export interface PropagationResult {
  successful: string[];
  failed: string[];
  timed_out: string[];
  duration_ms: number;
}

/**
 * ContextPropagator handles atomic context switch propagation to all tab surfaces.
 *
 * Design:
 * - Updates all tabs with new context concurrently
 * - Tracks success/failure for each tab
 * - Implements timeout for each tab (500ms)
 * - Cancels propagation if a new context arrives during progress
 * - Ensures final state is consistent across all tabs
 */
export class ContextPropagator {
  private registeredTabs: Map<string, TabSurface> = new Map();
  private propagationAbortController: AbortController | null = null;
  private readonly PROPAGATION_TIMEOUT = 500; // ms

  /**
   * Register a tab for context propagation.
   */
  registerTab(tab: TabSurface): void {
    this.registeredTabs.set(tab.getTabId(), tab);
  }

  /**
   * Unregister a tab.
   */
  unregisterTab(tabId: string): void {
    this.registeredTabs.delete(tabId);
  }

  /**
   * Propagate context to all registered tabs.
   * Cancels any in-progress propagation first.
   */
  async propagateContext(context: ActiveContext | null): Promise<PropagationResult> {
    // Cancel previous propagation if still in progress
    this.propagationAbortController?.abort();

    const controller = new AbortController();
    this.propagationAbortController = controller;

    const startTime = Date.now();
    const result: PropagationResult = {
      successful: [],
      failed: [],
      timed_out: [],
      duration_ms: 0,
    };

    const propagationPromises: Promise<void>[] = [];

    for (const [tabId, tab] of this.registeredTabs) {
      const tabPromise = this.propagateTabWithTimeout(tab, context, controller.signal)
        .then(success => {
          if (success) {
            result.successful.push(tabId);
          }
        })
        .catch(error => {
          if (error instanceof Error && error.name === "AbortError") {
            // Propagation was cancelled
            return;
          }

          if (error instanceof Error && error.message === "TIMEOUT") {
            result.timed_out.push(tabId);
          } else {
            result.failed.push(tabId);
            console.error(`Failed to propagate context to tab ${tabId}:`, error);
          }
        });

      propagationPromises.push(tabPromise);
    }

    try {
      await Promise.all(propagationPromises);
      result.duration_ms = Date.now() - startTime;

      if (controller.signal.aborted) {
        throw this.createAbortError();
      }

      return result;
    } finally {
      if (this.propagationAbortController === controller) {
        this.propagationAbortController = null;
      }
    }
  }

  /**
   * Propagate context to a single tab with timeout.
   */
  private async propagateTabWithTimeout(
    tab: TabSurface,
    context: ActiveContext | null,
    signal: AbortSignal
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
      };

      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const onAbort = (): void => {
        settle(() => reject(this.createAbortError()));
      };

      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error("TIMEOUT")));
      }, this.PROPAGATION_TIMEOUT);

      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }

      Promise.resolve()
        .then(() => tab.onContextChange(context))
        .then(
          () => settle(() => resolve(true)),
          error => settle(() => reject(error))
        );
    });
  }

  private createAbortError(): Error {
    const error = new Error("Propagation cancelled");
    error.name = "AbortError";
    return error;
  }

  /**
   * Get the number of registered tabs.
   */
  getTabCount(): number {
    return this.registeredTabs.size;
  }

  /**
   * Clear all registered tabs.
   */
  clearAllTabs(): void {
    this.registeredTabs.clear();
  }
}

/**
 * Global singleton instance.
 */
let globalPropagator: ContextPropagator | null = null;

/**
 * Get the global context propagator instance.
 */
export function getContextPropagator(): ContextPropagator {
  if (!globalPropagator) {
    globalPropagator = new ContextPropagator();
  }
  return globalPropagator;
}

/**
 * Reset the global singleton (for testing).
 */
export function resetContextPropagator(): void {
  globalPropagator = null;
}
