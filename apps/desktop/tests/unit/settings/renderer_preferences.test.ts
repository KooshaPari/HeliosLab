import { RendererPreferencesManager } from "../../../src/settings/renderer_preferences";

import { resolve } from "path";

describe("RendererPreferencesManager", () => {
  let tempPath: string;
  let manager: RendererPreferencesManager;

  beforeEach(() => {
    tempPath = resolve("/tmp/test-renderer-prefs.json");
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
