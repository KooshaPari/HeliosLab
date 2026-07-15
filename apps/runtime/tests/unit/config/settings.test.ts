/**
 * FR-HELIOS-038: Settings Manager Tests
 * Verifies: FR-CFG-001 (Typed settings schema), FR-CFG-002 (Validation), FR-CFG-004 (Restore on startup), FR-CFG-007 (settings.changed events)
 * Traces to: FR-MVP-012 (persist settings)
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonSettingsStore } from "../../../src/config/store.js";
import { SETTINGS_SCHEMA } from "../../../src/config/schema.js";
import { SettingsManager } from "../../../src/config/settings.js";
import type { SettingChangeEvent, SettingsStore } from "../../../src/config/types.js";

let tempDir: string;
let filePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "settings-mgr-"));
  filePath = join(tempDir, "settings.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createManager(busFn?: (t: string, e: SettingChangeEvent) => void) {
  const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
  return new SettingsManager(SETTINGS_SCHEMA, store, busFn);
}

// FR-001: Fresh install defaults
describe("SettingsManager — init and defaults", () => {
  it("returns defaults on fresh init", async () => {
    const mgr = createManager();
    await mgr.init();
    expect(mgr.get("theme")).toBe("system");
    expect(mgr.get("renderer_engine")).toBe("ghostty");
    expect(mgr.get("terminal.scrollback_lines")).toBe(10000);
    expect(mgr.get("telemetry.enabled")).toBe(false);
    mgr.dispose();
  });

  it("get returns default for unset key", async () => {
    const mgr = createManager();
    await mgr.init();
    expect(mgr.get("terminal.scrollback_lines")).toBe(10000);
    mgr.dispose();
  });
});

// FR-002: Validation on set
describe("SettingsManager — set / validation", () => {
  it("sets a valid value and returns change event", async () => {
    const mgr = createManager();
    await mgr.init();
    const evt = await mgr.set("theme", "dark");
    expect(evt.oldValue).toBe("system");
    expect(evt.newValue).toBe("dark");
    expect(mgr.get("theme")).toBe("dark");
    mgr.dispose();
  });

  it("rejects invalid value", async () => {
    const mgr = createManager();
    await mgr.init();
    await expect(mgr.set("theme", "purple")).rejects.toThrow();
    mgr.dispose();
  });

  it("rejects null value", async () => {
    const mgr = createManager();
    await mgr.init();
    await expect(mgr.set("telemetry.enabled", null)).rejects.toThrow();
    mgr.dispose();
  });

  // FR-002: Number range validation
  it("rejects out-of-range number", async () => {
    const mgr = createManager();
    await mgr.init();
    await expect(mgr.set("terminal.scrollback_lines", 10)).rejects.toThrow();
    mgr.dispose();
  });

  it("allows setting unknown key (forward-compat)", async () => {
    const mgr = createManager();
    await mgr.init();
    const evt = await mgr.set("future.key", "value");
    expect(evt.newValue).toBe("value");
    mgr.dispose();
  });
});

// FR-001: Persistence across restart
describe("SettingsManager — persistence", () => {
  it("persists settings across restart", async () => {
    const mgr1 = createManager();
    await mgr1.init();
    await mgr1.set("theme", "dark");
    mgr1.dispose();

    const mgr2 = createManager();
    await mgr2.init();
    expect(mgr2.get("theme")).toBe("dark");
    mgr2.dispose();
  });
});

// FR-001: Reset
describe("SettingsManager — reset", () => {
  it("resets to default", async () => {
    const mgr = createManager();
    await mgr.init();
    await mgr.set("theme", "dark");
    const evt = await mgr.reset("theme");
    expect(evt.newValue).toBe("system");
    expect(mgr.get("theme")).toBe("system");
    mgr.dispose();
  });
});

// FR-003: Hot-reload propagation
describe("SettingsManager — hot-reload", () => {
  it("publishes bus event for hot-reloadable setting", async () => {
    const topics: string[] = [];
    const events: SettingChangeEvent[] = [];
    const mgr = createManager((topic, evt) => {
      topics.push(topic);
      events.push(evt);
    });
    await mgr.init();
    await mgr.set("theme", "dark");
    expect(topics).toEqual(["settings.changed"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      key: "theme",
      oldValue: "system",
      newValue: "dark",
      reloadPolicy: "hot",
      restartRequired: false,
    });
    mgr.dispose();
  });

  it("publishes restart-required changes with explicit metadata", async () => {
    const events: SettingChangeEvent[] = [];
    const mgr = createManager((_topic, evt) => events.push(evt));
    await mgr.init();
    await mgr.set("renderer_engine", "rio");
    expect(events).toEqual([
      {
        key: "renderer_engine",
        oldValue: "ghostty",
        newValue: "rio",
        reloadPolicy: "restart",
        restartRequired: true,
      },
    ]);
    expect(mgr.isRestartRequired()).toBe(true);
    mgr.dispose();
  });

  it("persists before publishing and notifies subscribers after the bus", async () => {
    const order: string[] = [];
    const store: SettingsStore = {
      load: async () => ({}),
      save: async () => {
        order.push("persist");
      },
      watch: () => () => {},
    };
    const mgr = new SettingsManager(SETTINGS_SCHEMA, store, () => order.push("bus"));
    await mgr.init();
    mgr.onSettingChanged(() => order.push("listener"));

    await mgr.set("theme", "dark");

    expect(order).toEqual(["persist", "bus", "listener"]);
    mgr.dispose();
  });

  it("isolates bus failures after persistence and still notifies subscribers", async () => {
    const directEvents: SettingChangeEvent[] = [];
    const mgr = createManager(() => {
      throw new Error("bus unavailable");
    });
    await mgr.init();
    mgr.onSettingChanged(event => directEvents.push(event));

    const event = await mgr.set("renderer_engine", "rio");

    expect(event.restartRequired).toBe(true);
    expect(directEvents).toEqual([event]);
    expect(mgr.get("renderer_engine")).toBe("rio");
    mgr.dispose();
  });

  it("does not publish or mutate the cache when persistence fails", async () => {
    const events: SettingChangeEvent[] = [];
    const store: SettingsStore = {
      load: async () => ({}),
      save: async () => {
        throw new Error("disk full");
      },
      watch: () => () => {},
    };
    const mgr = new SettingsManager(SETTINGS_SCHEMA, store, (_topic, event) => events.push(event));
    await mgr.init();

    await expect(mgr.set("theme", "dark")).rejects.toThrow("disk full");

    expect(events).toHaveLength(0);
    expect(mgr.get("theme")).toBe("system");
    mgr.dispose();
  });

  it("direct subscriber receives all change events", async () => {
    const events: SettingChangeEvent[] = [];
    const mgr = createManager();
    await mgr.init();
    mgr.onSettingChanged(e => events.push(e));
    await mgr.set("theme", "dark");
    await mgr.set("renderer_engine", "rio");
    expect(events).toHaveLength(2);
    mgr.dispose();
  });
});

// FR-003: Restart-required tracking
describe("SettingsManager — restart required", () => {
  it("isRestartRequired returns false initially", async () => {
    const mgr = createManager();
    await mgr.init();
    expect(mgr.isRestartRequired()).toBe(false);
    mgr.dispose();
  });

  it("isRestartRequired returns true after restart-required change", async () => {
    const mgr = createManager();
    await mgr.init();
    await mgr.set("renderer_engine", "rio");
    expect(mgr.isRestartRequired()).toBe(true);
    expect(mgr.getChangedRestartSettings()).toEqual(["renderer_engine"]);
    mgr.dispose();
  });
});

// FR-010: getAll
describe("SettingsManager — getAll", () => {
  it("returns snapshot of all settings", async () => {
    const mgr = createManager();
    await mgr.init();
    const all = mgr.getAll();
    expect(all["theme"]).toBe("system");
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(4);
    mgr.dispose();
  });
});
