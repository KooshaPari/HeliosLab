import { RendererPreferencesManager } from "../../../src/settings/renderer_preferences";

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";

describe("RendererPreferencesManager", () => {
  let tempPath: string;
  let manager: RendererPreferencesManager;

  beforeEach(() => {
    tempPath = resolve("/tmp/test-renderer-prefs.json");
    try {
      unlinkSync(tempPath);
    } catch {
      // File might not exist
    }
    manager = new RendererPreferencesManager(tempPath);
  });

  afterEach(() => {
    try {
      unlinkSync(tempPath);
    } catch {
      // File might not exist
    }
  });

  it("should load default preferences when file does not exist", () => {
    const prefs = manager.load();

    expect(prefs.activeRenderer).toBe("ghostty");
    expect(prefs.hotSwapEnabled).toBe(true);
  });

  it("should save and load preferences", () => {
    manager.save({
      activeRenderer: "rio",
      hotSwapEnabled: false,
    });

    const newManager = new RendererPreferencesManager(tempPath);
    const prefs = newManager.load();

    expect(prefs.activeRenderer).toBe("rio");
    expect(prefs.hotSwapEnabled).toBe(false);
  });

  it("should handle a preferences directory creation failure", () => {
    const blockingPath = resolve("/tmp/test-renderer-prefs-blocker");
    const originalConsoleError = console.error;
    const errorLog = mock((_message?: unknown, _error?: unknown) => {});
    writeFileSync(blockingPath, "not a directory");
    console.error = errorLog;

    try {
      const blockedManager = new RendererPreferencesManager(resolve(blockingPath, "prefs.json"));

      expect(() => blockedManager.save({ activeRenderer: "rio" })).not.toThrow();
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog.mock.calls[0]?.[0]).toBe("Failed to create preferences directory");
      expect(errorLog.mock.calls[0]?.[1]).toHaveProperty("code", "EEXIST");
      expect(errorLog.mock.calls[1]?.[0]).toBe("Failed to save renderer preferences");
      expect(errorLog.mock.calls[1]?.[1]).toHaveProperty("code");
      expect(errorLog.mock.calls[1]?.[1]).not.toBeInstanceOf(ReferenceError);
    } finally {
      console.error = originalConsoleError;
      unlinkSync(blockingPath);
    }
  });

  it("should handle corrupted JSON file", () => {
    writeFileSync(tempPath, "invalid json {{{");

    const prefs = manager.load();

    expect(prefs.activeRenderer).toBe("ghostty");
    expect(prefs.hotSwapEnabled).toBe(true);
  });

  it("should handle missing required fields", () => {
    const corruptData = { activeRenderer: "rio" }; // Missing hotSwapEnabled
    writeFileSync(tempPath, JSON.stringify(corruptData));

    const prefs = manager.load();

    expect(prefs.activeRenderer).toBe("ghostty");
    expect(prefs.hotSwapEnabled).toBe(true);
  });

  it("should get active renderer", () => {
    manager.save({ activeRenderer: "rio" });

    expect(manager.getActiveRenderer()).toBe("rio");
  });

  it("should set active renderer", () => {
    manager.load();
    manager.setActiveRenderer("rio");

    expect(manager.getActiveRenderer()).toBe("rio");
    expect(manager.isDirtyCheck()).toBe(true);
  });

  it("should get hot-swap enabled status", () => {
    manager.load();

    expect(manager.isHotSwapEnabled()).toBe(true);
  });

  it("should set hot-swap enabled status", () => {
    manager.load();
    manager.setHotSwapEnabled(false);

    expect(manager.isHotSwapEnabled()).toBe(false);
    expect(manager.isDirtyCheck()).toBe(true);
  });

  it("should mark as dirty", () => {
    manager.load();

    expect(manager.isDirtyCheck()).toBe(false);

    manager.markDirty();

    expect(manager.isDirtyCheck()).toBe(true);
  });

  it("should get all preferences", () => {
    manager.save({ activeRenderer: "rio", hotSwapEnabled: false });

    const prefs = manager.getPreferences();

    expect(prefs.activeRenderer).toBe("rio");
    expect(prefs.hotSwapEnabled).toBe(false);
  });

  it("should not mark dirty if value does not change", () => {
    manager.load();
    expect(manager.isDirtyCheck()).toBe(false);

    manager.setActiveRenderer("ghostty"); // Same as default

    expect(manager.isDirtyCheck()).toBe(false);
  });
});
