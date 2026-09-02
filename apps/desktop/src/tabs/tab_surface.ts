import { type ActiveContext, getActiveContextStore } from "./context_switch";

export type { ActiveContext };

export type TabType = "terminal" | "agent" | "session" | "chat" | "project";

/**
 * Serializable state for a tab surface, persisted across restarts.
 */
export interface TabState {
  tabId: string;
  tabType: TabType;
  label: string;
  scrollPosition?: number;
  selection?: string;
  expandedSections?: string[];
  customData?: Record<string, unknown>;
}

/**
 * Abstract base class for all tab surfaces. Handles context binding,
 * lifecycle management, and error handling.
 *
 * Design:
 * - Each tab subscribes to context changes on construction.
 * - onContextChange is called when the active context updates.
 * - Error boundary catches render errors and displays error state.
 * - Subclasses implement render() and context-specific logic.
 */
export abstract class TabSurface {
  protected tabId: string;
  protected tabType: TabType;
  protected label: string;
  protected isActive: boolean = false;
  protected staleContext: boolean = false;
  protected lastContext: ActiveContext | null = null;
  protected errorMessage: string | null = null;
  protected unsubscribeContext: (() => void) | null = null;

  constructor(tabId: string, tabType: TabType, label: string) {
    this.tabId = tabId;
    this.tabType = tabType;
    this.label = label;

    // Subscribe to context changes
    const store = getActiveContextStore();
    this.unsubscribeContext = store.onContextChange(async event => {
      try {
        this.staleContext = false;
        this.errorMessage = null;
        await this.onContextChange(event.current);
        this.lastContext = event.current;
      } catch {
        this.staleContext = true;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.errorMessage = errorMsg;
        console.error(`[${this.tabType}] Context change failed:`, errorMsg);

        // Emit error event
        try {
          const _store = getActiveContextStore();
          // Note: would publish to bus if it was available
        } catch {
          // Silently ignore if store not available
        }
      }
    });
  }

  /**
   * Get the tab ID.
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Get the tab type.
   */
  getTabType(): TabType {
    return this.tabType;
  }

  /**
   * Get the tab label.
   */
  getLabel(): string {
    return this.label;
  }

  /**
   * Check if this tab is currently active/selected.
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Check if this tab has a stale context (failed to update).
   */
  hasStaleContext(): boolean {
    return this.staleContext;
  }

  /**
   * Get the error message if render failed.
   */
  getErrorMessage(): string | null {
    return this.errorMessage;
  }

  /**
   * Called when the active context changes.
   * Subclasses override to update their content.
   */
  abstract onContextChange(context: ActiveContext | null): Promise<void>;

  /**
   * Called when this tab becomes the selected/active tab.
   */
  onActivate(): void {
    this.isActive = true;
  }

  /**
   * Called when another tab becomes selected.
   */
  onDeactivate(): void {
    this.isActive = false;
  }

  /**
   * Render the tab content. Subclasses implement this.
   * Should catch and handle errors gracefully.
   */
  abstract render(): HTMLElement;

  /**
   * Get the current serializable state of this tab.
   */
  getState(): TabState {
    return {
      tabId: this.tabId,
      tabType: this.tabType,
      label: this.label,
    };
  }

  /**
   * Restore state from persisted data.
   */
  restoreState(state: TabState): void {
    this.label = state.label;
    // Subclasses can override to restore custom state
  }

  /**
   * Clean up resources before tab is destroyed.
   */
  destroy(): void {
    if (this.unsubscribeContext) {
      this.unsubscribeContext();
      this.unsubscribeContext = null;
    }
  }

  /**
   * Render the tab with error boundary applied.
   */
  renderWithErrorBoundary(): HTMLElement {
    try {
      return this.render();
    } catch {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.errorMessage = errorMsg;
      console.error(`[${this.tabType}] Render error:`, errorMsg);

      // Create error display element using safe DOM methods
      const errorEl = document.createElement("div");
      errorEl.className = "tab-error-boundary";
      errorEl.style.padding = "16px";
      errorEl.style.color = "#d32f2f";
      errorEl.style.backgroundColor = "#ffebee";
      errorEl.style.borderRadius = "4px";
      errorEl.style.margin = "8px";

      const titleEl = document.createElement("div");
      titleEl.style.fontWeight = "bold";
      titleEl.textContent = "Tab Error";

      const msgEl = document.createElement("div");
      msgEl.style.fontSize = "12px";
      msgEl.style.marginTop = "8px";
      msgEl.textContent = errorMsg;

      errorEl.appendChild(titleEl);
      errorEl.appendChild(msgEl);

      return errorEl;
    }
  }
}

/**
 * Factory function to create a mock tab for testing.
 */
export function createMockTabSurface(tabId: string, tabType: TabType, label: string): TabSurface {
  return new (class extends TabSurface {
    async onContextChange(_context: ActiveContext | null): Promise<void> {
      // Mock implementation does nothing
    }

    render(): HTMLElement {
      const _el = document.createElement("div");
      el.textContent = `${this.label} (${this.tabType})`;
      return el;
    }
  })(tabId, tabType, label);
}
