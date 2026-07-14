import {
  KeyboardShortcuts,
  type ShortcutAction,
  resetKeyboardShortcuts,
} from "../../../src/tabs/keyboard_shortcuts";
import * as path from "path";
import { promises as fs } from "fs";
import { tmpdir } from "os";

describe("KeyboardShortcuts", () => {
  let shortcuts: KeyboardShortcuts;
  let tempDir: string;

  beforeEach(async () => {
    resetKeyboardShortcuts();
    tempDir = path.join(tmpdir(), `keyboard-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    shortcuts = new KeyboardShortcuts(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Default Shortcuts", () => {
    it("should have default shortcuts", () => {
      const shortcuts_map = shortcuts.getShortcuts();
      expect(shortcuts_map["select-terminal"]).toBeDefined();
      expect(shortcuts_map["select-agent"]).toBeDefined();
      expect(shortcuts_map["select-session"]).toBeDefined();
      expect(shortcuts_map["select-chat"]).toBeDefined();
      expect(shortcuts_map["select-project"]).toBeDefined();
    });

    it("should get specific shortcut", () => {
      const shortcut = shortcuts.getShortcut("select-terminal");
      expect(shortcut).toBe("Cmd+1");
    });
  });

  describe("Remapping", () => {
    it("should remap a shortcut", () => {
      const success = shortcuts.remapShortcut("select-terminal", "Cmd+T");
      expect(success).toBe(true);
      expect(shortcuts.getShortcut("select-terminal")).toBe("Cmd+T");
    });

    it("should detect shortcut conflicts", () => {
      shortcuts.remapShortcut("select-terminal", "Cmd+1");
      const success = shortcuts.remapShortcut("select-agent", "Cmd+1");

      // Should fail due to conflict
      expect(success).toBe(false);
      expect(shortcuts.getShortcut("select-agent")).not.toBe("Cmd+1");
    });

    it("should reject invalid actions", () => {
      const success = shortcuts.remapShortcut("invalid-action" as ShortcutAction, "Cmd+X");
      expect(success).toBe(false);
    });
  });

  describe("Reset", () => {
    it("should reset to defaults", () => {
      shortcuts.remapShortcut("select-terminal", "Cmd+T");
      shortcuts.resetToDefaults();

      expect(shortcuts.getShortcut("select-terminal")).toBe("Cmd+1");
    });
  });

  describe("Event Handling", () => {
    it("should handle keyboard events", () => {
      let handledAction: ShortcutAction | null = null;

      shortcuts.setHandler(action => {
        handledAction = action;
      });

      const event = new KeyboardEvent("keydown", {
        key: "1",
        metaKey: true,
        bubbles: true,
      });

      shortcuts.handleKeyboardEvent(event);

      expect(handledAction!).toBe("select-terminal");
    });

    it("should support shortcut listeners", () => {
      let actions: ShortcutAction[] = [];

      shortcuts.onShortcut(action => {
        actions.push(action);
      });

      const event = new KeyboardEvent("keydown", {
        key: "2",
        metaKey: true,
        bubbles: true,
      });

      shortcuts.handleKeyboardEvent(event);

      expect(actions).toContain("select-agent");
    });

    it("should allow unsubscribing from shortcuts", () => {
      let callCount = 0;

      const unsubscribe = shortcuts.onShortcut(() => {
        callCount++;
      });

      const event = new KeyboardEvent("keydown", {
        key: "1",
        metaKey: true,
        bubbles: true,
      });

      shortcuts.handleKeyboardEvent(event);
      expect(callCount).toBe(1);

      unsubscribe();

      shortcuts.handleKeyboardEvent(event);
      expect(callCount).toBe(1); // Should not increment
    });
  });

  describe("Persistence", () => {
    it("should load shortcuts from disk", async () => {
      shortcuts.remapShortcut("select-terminal", "Cmd+T");
      await shortcuts.save();

      const newShortcuts = new KeyboardShortcuts(tempDir);
      await newShortcuts.load();

      expect(newShortcuts.getShortcut("select-terminal")).toBe("Cmd+T");
    });

    it("should use defaults if file not found", async () => {
      const newShortcuts = new KeyboardShortcuts(tempDir);
      await newShortcuts.load();

      expect(newShortcuts.getShortcut("select-terminal")).toBe("Cmd+1");
    });

    it("should handle invalid JSON gracefully", async () => {
      const configPath = path.join(tempDir, "keyboard_shortcuts.json");
      await fs.writeFile(configPath, "invalid json {", "utf-8");

      const newShortcuts = new KeyboardShortcuts(tempDir);
      await newShortcuts.load();

      // Should fall back to defaults
      expect(newShortcuts.getShortcut("select-terminal")).toBe("Cmd+1");
    });
  });

  describe("Navigation Shortcuts", () => {
    it("should support previous tab shortcut", () => {
      const shortcut = shortcuts.getShortcut("previous-tab");
      expect(shortcut).toBe("Cmd+[");
    });

    it("should support next tab shortcut", () => {
      const shortcut = shortcuts.getShortcut("next-tab");
      expect(shortcut).toBe("Cmd+]");
    });

    it("should support focus tab bar shortcut", () => {
      const shortcut = shortcuts.getShortcut("focus-tabbar");
      expect(shortcut).toBe("Cmd+Shift+T");
    });
  });
});
