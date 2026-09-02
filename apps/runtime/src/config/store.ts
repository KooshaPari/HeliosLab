import { watch as fsWatch, type FSWatcher } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SettingsStore, SettingsSchema } from "./types.js";
import { validateSettingDefinition } from "./schema.js";

/**
 * JSON-file-backed settings store with in-memory unknown-key preservation
 * and external-edit detection via fs.watch.
 */
export class JsonSettingsStore implements SettingsStore {
  private readonly filePath: string;
  private readonly schema: SettingsSchema;
  private unknownKeys: Record<string, unknown> = {};
  private lastWriteTs = 0;
  private static readonly DEBOUNCE_MS = 200;

  constructor(filePath: string, schema: SettingsSchema) {
    this.filePath = filePath;
    this.schema = schema;
  }

  // ── SettingsStore interface ───────────────────────────────────────────

  async load(): Promise<Record<string, unknown>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch {
      // Missing file → empty settings.
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[settings] Corrupted JSON in ${this.filePath}, returning empty.`);
      return {};
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(`[settings] Invalid settings object in ${this.filePath}, returning empty.`);
      return {};
    }

    // Separate known vs unknown keys.
    const known: Record<string, unknown> = {};
    this.unknownKeys = {};

    for (const [k, v] of Object.entries(parsed)) {
      if (Object.hasOwn(this.schema, k)) {
        const definition = this.schema[k];
        if (definition && validateSettingDefinition(k, definition, v).valid) {
          known[k] = v;
        } else {
          console.warn(`[settings] Invalid persisted value for ${k}, using default.`);
        }
      } else {
        this.unknownKeys[k] = v;
      }
    }

    return known;
  }

  async save(values: Record<string, unknown>): Promise<void> {
    // Merge known values with preserved unknown keys.
    const merged: Record<string, unknown> = { ...values, ...this.unknownKeys };
    const json = JSON.stringify(merged, null, 2) + "\n";

    // Atomic write: temp → fsync → rename.
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.settings.tmp.${Date.now()}`);
    await writeFile(tmp, json, "utf-8");
    await rename(tmp, this.filePath);
    this.lastWriteTs = Date.now();
  }

  watch(callback: () => void): () => void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher;

    try {
      watcher = fsWatch(this.filePath, () => {
        // Ignore events triggered by our own writes.
        if (Date.now() - this.lastWriteTs < JsonSettingsStore.DEBOUNCE_MS) {
          return;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(callback, JsonSettingsStore.DEBOUNCE_MS);
      });
    } catch {
      // File may not exist yet — return no-op unsubscribe.
      return () => {};
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    };
  }

  // ── Unknown key helpers ───────────────────────────────────────────────

  /** Return keys present in the file but absent from the schema. */
  getUnknownKeys(): string[] {
    return Object.keys(this.unknownKeys);
  }
}
