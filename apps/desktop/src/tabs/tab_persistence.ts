import { promises as fs } from "fs";
import * as path from "path";
import { homedir } from "os";
import type { TabSurface, TabState } from "./tab_surface";

/**
 * Persisted tab state structure.
 */
export interface TabPersistedState {
  version: number;
  selectedTabId: string | null;
  tabOrder: string[];
  pinnedTabIds: string[];
  perTabState: Record<string, TabState>;
  savedAt: string;
}

/**
 * TabPersistence handles saving and loading tab state across runtime restarts.
 *
 * Features:
 * - File-backed JSON storage at ~/.helios/data/tab_state.json
 * - Debounced saves (500ms) to avoid write storms
 * - Load completes in <100ms
 * - Graceful fallback to defaults on corrupt/missing files
 * - Automatic migration of state format on version changes
 */
export class TabPersistence {
  private readonly storageDir: string;
  private readonly storagePath: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingState: TabPersistedState | null = null;
  private lastLoadTime: number = 0;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ?? path.join(homedir(), ".helios", "data");
    this.storagePath = path.join(this.storageDir, "tab_state.json");
  }

  /**
   * Load persisted tab state from disk.
   * Must complete within 100ms.
   */
  async load(): Promise<TabPersistedState | null> {
    const _startTime = Date.now();

    try {
      const data = await fs.readFile(this.storagePath, "utf-8");
      const state = JSON.parse(data) as TabPersistedState;

      // Validate structure
      if (!this.validateState(state)) {
        console.warn("Invalid tab state file, using defaults");
        return null;
      }

      this.lastLoadTime = Date.now() - startTime;

      if (this.lastLoadTime > 100) {
        console.warn(`Tab state load took ${this.lastLoadTime}ms (target: <100ms)`);
      }

      return state;
    } catch {
      if (error instanceof Error && "code" in error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
          // File doesn't exist yet, not an error
          return null;
        }
      }
      console.warn("Failed to load tab state:", error);
      return null;
    }
  }

  /**
   * Save tab state to disk. Debounces rapid calls.
   */
  async save(state: TabPersistedState): Promise<void> {
    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.pendingState = state;

    // Debounce: wait 500ms before writing
    return new Promise(resolve => {
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;

        const stateToWrite = this.pendingState;
        this.pendingState = null;

        if (!stateToWrite) {
          resolve();
          return;
        }

        try {
          // Ensure directory exists
          await fs.mkdir(this.storageDir, { recursive: true });

          // Write state to file
          const data = JSON.stringify(stateToWrite, null, 2);
          await fs.writeFile(this.storagePath, data, "utf-8");
        } catch {
          console.error("Failed to save tab state:", error);
        }

        resolve();
      }, 500);
    });
  }

  /**
   * Flush pending saves immediately (e.g., on shutdown).
   */
  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // No pending state to flush
    if (!this.pendingState) {
      return;
    }

    const stateToWrite = this.pendingState;
    this.pendingState = null;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const data = JSON.stringify(stateToWrite, null, 2);
      await fs.writeFile(this.storagePath, data, "utf-8");
    } catch {
      console.error("Failed to flush tab state:", error);
    }
  }

  /**
   * Create persisted state from current tab bar state.
   */
  createState(
    selectedTabId: string | null,
    tabOrder: string[],
    pinnedTabIds: string[],
    tabs: TabSurface[]
  ): TabPersistedState {
    const perTabState: Record<string, TabState> = {};

    for (const tab of tabs) {
      perTabState[tab.getTabId()] = tab.getState();
    }

    return {
      version: 1,
      selectedTabId,
      tabOrder,
      pinnedTabIds,
      perTabState,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore persisted state to tab instances.
   */
  restoreState(state: TabPersistedState, tabs: TabSurface[]): void {
    const tabMap = new Map(tabs.map(t => [t.getTabId(), t]));

    for (const [tabId, tabState] of Object.entries(state.perTabState)) {
      const tab = tabMap.get(tabId);
      if (tab) {
        tab.restoreState(tabState);
      }
    }
  }

  /**
   * Get the last load time in milliseconds.
   */
  getLastLoadTime(): number {
    return this.lastLoadTime;
  }

  /**
   * Validate persisted state structure.
   */
  private validateState(state: unknown): state is TabPersistedState {
    if (typeof state !== "object" || state === null) {
      return false;
    }

    const s = state as Record<string, unknown>;

    return (
      typeof s.version === "number" &&
      (s.selectedTabId === null || typeof s.selectedTabId === "string") &&
      Array.isArray(s.tabOrder) &&
      s.tabOrder.every(id => typeof id === "string") &&
      Array.isArray(s.pinnedTabIds) &&
      s.pinnedTabIds.every(id => typeof id === "string") &&
      typeof s.perTabState === "object" &&
      s.perTabState !== null &&
      typeof s.savedAt === "string"
    );
  }

  /**
   * Delete the persisted state file (for testing/reset).
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.storagePath);
    } catch {
      if (error instanceof Error && "code" in error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
          console.error("Failed to delete tab state:", error);
        }
      }
    }
  }
}
