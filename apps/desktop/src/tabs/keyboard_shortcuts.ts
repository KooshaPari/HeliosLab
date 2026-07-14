import { promises as fs } from "fs";
import * as path from "path";
import { homedir } from "os";

export interface ShortcutMap {
  [key: string]: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  "select-terminal": "Cmd+1",
  "select-agent": "Cmd+2",
  "select-session": "Cmd+3",
  "select-chat": "Cmd+4",
  "select-project": "Cmd+5",
  "previous-tab": "Cmd+[",
  "next-tab": "Cmd+]",
  "focus-tabbar": "Cmd+Shift+T",
};

export type ShortcutAction =
  | "select-terminal"
  | "select-agent"
  | "select-session"
  | "select-chat"
  | "select-project"
  | "previous-tab"
  | "next-tab"
  | "focus-tabbar";

export type ShortcutHandler = (action: ShortcutAction) => void;

/**
 * KeyboardShortcuts manages keyboard navigation and actions for tabs.
 *
 * Features:
 * - Default shortcuts for all tab operations
 * - User-configurable remapping
 * - Conflict detection
 * - Persistence to ~/.helios/data/keyboard_shortcuts.json
 * - Global keyboard event listener
 */
export class KeyboardShortcuts {
  private shortcuts: ShortcutMap;
  private reverseShortcuts: Map<string, ShortcutAction> = new Map();
  private handler: ShortcutHandler | null = null;
  private listeners: Set<(action: ShortcutAction) => void> = new Set();
  private configPath: string;

  constructor(configDir?: string) {
    this.configPath = path.join(
      configDir ?? path.join(homedir(), ".helios", "data"),
      "keyboard_shortcuts.json"
    );
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.buildReverseMap();
  }

  /**
   * Load shortcuts from disk.
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, "utf-8");
      const loaded = JSON.parse(data) as ShortcutMap;

      // Validate loaded shortcuts
      for (const [action, shortcut] of Object.entries(loaded)) {
        if (this.isValidAction(action as ShortcutAction)) {
          this.shortcuts[action] = shortcut;
        }
      }

      this.buildReverseMap();
    } catch {
      // File not found or parse error, use defaults
      this.shortcuts = { ...DEFAULT_SHORTCUTS };
      this.buildReverseMap();
    }
  }

  /**
   * Save shortcuts to disk.
   */
  async save(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      const data = JSON.stringify(this.shortcuts, null, 2);
      await fs.writeFile(this.configPath, data, "utf-8");
    } catch {
      console.error("Failed to save keyboard shortcuts:", error);
    }
  }

  /**
   * Get all shortcuts.
   */
  getShortcuts(): ShortcutMap {
    return { ...this.shortcuts };
  }

  /**
   * Get shortcut for an action.
   */
  getShortcut(action: ShortcutAction): string {
    return this.shortcuts[action] ?? DEFAULT_SHORTCUTS[action] ?? "";
  }

  /**
   * Remap a shortcut.
   */
  remapShortcut(action: ShortcutAction, shortcut: string): boolean {
    if (!this.isValidAction(action)) {
      console.error(`Invalid action: ${action}`);
      return false;
    }

    // Check for conflicts with other actions
    for (const [existingAction, existingShortcut] of Object.entries(this.shortcuts)) {
      if (
        existingAction !== action &&
        this.normalizeShortcut(existingShortcut) === this.normalizeShortcut(shortcut)
      ) {
        console.error(`Shortcut conflict: "${shortcut}" is already mapped to "${existingAction}"`);
        return false;
      }
    }

    this.shortcuts[action] = shortcut;
    this.buildReverseMap();
    return true;
  }

  /**
   * Reset all shortcuts to defaults.
   */
  resetToDefaults(): void {
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.buildReverseMap();
  }

  /**
   * Register a handler for shortcut actions.
   */
  setHandler(handler: ShortcutHandler): void {
    this.handler = handler;
  }

  /**
   * Register a listener for shortcut actions.
   */
  onShortcut(listener: (action: ShortcutAction) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Handle keyboard event and trigger shortcut if matched.
   */
  handleKeyboardEvent(event: KeyboardEvent): boolean {
    const shortcutStr = this.eventToShortcut(event);

    const action = this.reverseShortcuts.get(shortcutStr);
    if (action) {
      event.preventDefault();

      if (this.handler) {
        this.handler(action);
      }

      for (const listener of this.listeners) {
        listener(action);
      }

      return true;
    }

    return false;
  }

  /**
   * Convert keyboard event to shortcut string.
   */
  private eventToShortcut(event: KeyboardEvent): string {
    const parts: string[] = [];

    if (event.metaKey) {
      parts.push("Cmd");
    } else if (event.ctrlKey) {
      parts.push("Ctrl");
    }
    if (event.altKey) {
      parts.push("Alt");
    }
    if (event.shiftKey) {
      parts.push("Shift");
    }

    // Add the key name
    const key = event.key.toUpperCase();
    parts.push(key);

    return parts.join("+");
  }

  /**
   * Normalize a shortcut string for comparison.
   */
  private normalizeShortcut(shortcut: string): string {
    // Replace Cmd with Ctrl for consistent comparison
    return shortcut.replace(/Cmd/g, "Ctrl").toUpperCase();
  }

  /**
   * Build reverse map from shortcuts to actions.
   */
  private buildReverseMap(): void {
    this.reverseShortcuts.clear();

    for (const [action, shortcut] of Object.entries(this.shortcuts)) {
      this.reverseShortcuts.set(shortcut, action as ShortcutAction);
    }
  }

  /**
   * Check if a string is a valid action.
   */
  private isValidAction(action: string): action is ShortcutAction {
    return [
      "select-terminal",
      "select-agent",
      "select-session",
      "select-chat",
      "select-project",
      "previous-tab",
      "next-tab",
      "focus-tabbar",
    ].includes(action);
  }
}

/**
 * Global singleton instance.
 */
let globalShortcuts: KeyboardShortcuts | null = null;

/**
 * Get the global keyboard shortcuts instance.
 */
export function getKeyboardShortcuts(configDir?: string): KeyboardShortcuts {
  if (!globalShortcuts) {
    globalShortcuts = new KeyboardShortcuts(configDir);
  }
  return globalShortcuts;
}

/**
 * Reset the global singleton (for testing).
 */
export function resetKeyboardShortcuts(): void {
  globalShortcuts = null;
}
