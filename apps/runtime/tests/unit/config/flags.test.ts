import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonSettingsStore } from "../../../src/config/store.js";
import { SETTINGS_SCHEMA } from "../../../src/config/schema.js";
import { SettingsManager } from "../../../src/config/settings.js";
import { FlagRegistry, RENDERER_ENGINE_FLAG, type FeatureFlag } from "../../../src/config/flags.js";

// Traces to: FR-MVP-012 (persist settings)

let tempDir: string;
let filePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "flags-test-"));
  filePath = join(tempDir, "settings.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createStack() {
  const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
  const settings = new SettingsManager(SETTINGS_SCHEMA, store);
  const flags = new FlagRegistry(settings);
  return { store, settings, flags };
}

// FR-008: Feature flag reads
describe("FlagRegistry — get", () => {
  it("returns default on fresh init", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    expect(flags.get<string>("renderer_engine")).toBe("ghostty");
    flags.dispose();
    settings.dispose();
  });

  it("returns persisted value after settings change", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    // renderer_engine is restart-required, so cache stays at old value
    // Use a hot-reloadable flag to test immediate update
    const themeFlagDef: FeatureFlag<string> = {
      key: "theme",
      defaultValue: "system",
      description: "App theme",
    };
    flags.register(themeFlagDef);
    // Re-init to pick up theme registration
    flags.dispose();
    flags.init();

    await settings.set("theme", "dark");
    expect(flags.get<string>("theme")).toBe("dark");
    flags.dispose();
    settings.dispose();
  });

  it("throws on unknown flag key", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.init();
    expect(() => flags.get("nonexistent")).toThrow("Unknown flag: nonexistent");
    flags.dispose();
    settings.dispose();
  });

  it("returns default before settings load", async () => {
    // FR-008: flag queried before init uses register-time value
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    // Don't call flags.init() — cache populated at register time
    expect(flags.get<string>("renderer_engine")).toBe("ghostty");
    flags.dispose();
    settings.dispose();
  });
});

// FR-009: renderer_engine flag
describe("FlagRegistry — renderer_engine", () => {
  it("getRendererEngine returns typed value", async () => {
    // FR-009
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    const engine: "ghostty" | "rio" = flags.getRendererEngine();
    expect(engine).toBe("ghostty");
    flags.dispose();
    settings.dispose();
  });

  it("rejects invalid renderer_engine value via schema", async () => {
    // FR-009
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await expect(settings.set("renderer_engine", "webgl")).rejects.toThrow();
    flags.dispose();
    settings.dispose();
  });

  it("setting to rio persists and returns rio via getPending", async () => {
    // FR-009
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await settings.set("renderer_engine", "rio");
    // restart-required: cache stays "ghostty", pending is "rio"
    expect(flags.getRendererEngine()).toBe("ghostty");
    const p = flags.getPending<"ghostty" | "rio">("renderer_engine");
    expect(p).not.toBeNull();
    expect(p!.current).toBe("ghostty");
    expect(p!.pending).toBe("rio");
    flags.dispose();
    settings.dispose();
  });

  it("all enum values are accepted", async () => {
    // FR-009
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    for (const val of ["ghostty", "rio"] as const) {
      await settings.set("renderer_engine", val);
    }
    flags.dispose();
    settings.dispose();
  });
});

// FR-008: restart-required semantics
describe("FlagRegistry — restart-required flags", () => {
  it("cache not updated for restart-required flag", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await settings.set("renderer_engine", "rio");
    expect(flags.get<string>("renderer_engine")).toBe("ghostty");
    expect(flags.pendingRestart).toBe(true);
    flags.dispose();
    settings.dispose();
  });

  it("getPending returns null for unchanged flag", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    expect(flags.getPending("renderer_engine")).toBeNull();
    flags.dispose();
    settings.dispose();
  });

  it("getPending returns current/pending pair", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await settings.set("renderer_engine", "rio");
    const p = flags.getPending<string>("renderer_engine");
    expect(p).toEqual({ current: "ghostty", pending: "rio" });
    flags.dispose();
    settings.dispose();
  });

  it("pending cleared when reverted to current value", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await settings.set("renderer_engine", "rio");
    expect(flags.pendingRestart).toBe(true);
    await settings.set("renderer_engine", "ghostty");
    expect(flags.pendingRestart).toBe(false);
    expect(flags.getPending("renderer_engine")).toBeNull();
    flags.dispose();
    settings.dispose();
  });

  it("multiple pending changes: last wins", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    await settings.set("renderer_engine", "rio");
    await settings.set("renderer_engine", "rio");
    const p = flags.getPending<string>("renderer_engine");
    expect(p).toEqual({ current: "ghostty", pending: "rio" });
    flags.dispose();
    settings.dispose();
  });
});

// FR-008: registration
describe("FlagRegistry — registration", () => {
  it("duplicate registration throws", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    expect(() => flags.register(RENDERER_ENGINE_FLAG)).toThrow("Flag already registered");
    flags.dispose();
    settings.dispose();
  });
});

// FR-008: getAll
describe("FlagRegistry — getAll", () => {
  it("returns all registered flag values", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    const all = flags.getAll();
    expect(all["renderer_engine"]).toBe("ghostty");
    expect(Object.keys(all)).toEqual(["renderer_engine"]);
    flags.dispose();
    settings.dispose();
  });
});

// FR-008: concurrent reads
describe("FlagRegistry — concurrency", () => {
  it("concurrent flag reads return consistent values", async () => {
    // FR-008
    const { settings, flags } = createStack();
    await settings.init();
    flags.register(RENDERER_ENGINE_FLAG);
    flags.init();
    const _results = await Promise.all(
      Array.from({ length: 1000 }, () => Promise.resolve(flags.get("renderer_engine")))
    );
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("ghostty");
    flags.dispose();
    settings.dispose();
  });
});
