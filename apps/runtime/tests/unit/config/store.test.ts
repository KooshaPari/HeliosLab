import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { JsonSettingsStore } from "../../../src/config/store.js";
import { SETTINGS_SCHEMA } from "../../../src/config/schema.js";

// Traces to: FR-MVP-012 (persist settings)

let tempDir: string;
let filePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "settings-store-"));
  filePath = join(tempDir, "settings.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// FR-001: Persistence
describe("JsonSettingsStore", () => {
  it("returns empty object when file is missing", async () => {
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    const data = await store.load();
    expect(data).toEqual({});
  });

  // FR-001: JSON round-trip
  it("round-trips known settings through save/load", async () => {
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    const values = { theme: "dark", "telemetry.enabled": true };
    await store.save(values);
    const loaded = await store.load();
    expect(loaded["theme"]).toBe("dark");
    expect(loaded["telemetry.enabled"]).toBe(true);
  });

  // FR-010: Corrupted file
  it("returns empty on corrupted JSON", async () => {
    await writeFile(filePath, "not json {{{", "utf-8");
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    const data = await store.load();
    expect(data).toEqual({});
  });

  // FR-005: Unknown key preservation
  it("preserves unknown keys through save/load", async () => {
    await writeFile(filePath, JSON.stringify({ theme: "dark", "future.setting": 42 }), "utf-8");
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    const loaded = await store.load();
    // Unknown keys should NOT appear in loaded (known-only).
    expect(loaded["future.setting"]).toBeUndefined();
    // But they should be preserved on save.
    await store.save(loaded);
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(raw["future.setting"]).toBe(42);
  });

  it("reports unknown keys via getUnknownKeys()", async () => {
    await writeFile(
      filePath,
      JSON.stringify({ "future.a": 1, "future.b": 2, theme: "dark" }),
      "utf-8"
    );
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    await store.load();
    expect(store.getUnknownKeys().sort()).toEqual(["future.a", "future.b"]);
  });

  // FR-003: File watch
  it("watch returns unsubscribe function", () => {
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    const unsub = store.watch(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("re-creates file on save after deletion", async () => {
    const store = new JsonSettingsStore(filePath, SETTINGS_SCHEMA);
    await store.save({ theme: "light" });
    await rm(filePath);
    await store.save({ theme: "dark" });
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(raw["theme"]).toBe("dark");
  });
});
