import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { DEFAULT_PATTERNS } from "./protected-paths-matching.js";
import type { ProtectedPathPattern } from "./protected-paths-types.js";

export class ProtectedPathConfig {
  private patterns: Map<string, ProtectedPathPattern> = new Map();
  private bus: LocalBus | null;
  private configPath: string | null;

  constructor(opts?: { bus?: LocalBus; configPath?: string }) {
    this.bus = opts?.bus ?? null;
    this.configPath = opts?.configPath ?? null;

    for (const p of DEFAULT_PATTERNS) {
      this.patterns.set(p.id, { ...p });
    }
  }

  addPattern(pattern: string, description: string): ProtectedPathPattern {
    if (!pattern || pattern.trim() === "") {
      throw new Error("Pattern must not be empty");
    }
    if (pattern === "*" || pattern === "**" || pattern === "**/*" || pattern === "*.*") {
      throw new Error(`Pattern '${pattern}' is too broad and would match all paths`);
    }
    const id = `custom-${randomBytes(4).toString("hex")}`;
    const entry: ProtectedPathPattern = {
      id,
      pattern,
      description,
      enabled: true,
      isDefault: false,
    };
    this.patterns.set(id, entry);
    void this._emit("secrets.protected_paths.config.changed", {
      action: "add",
      patternId: id,
      pattern,
    });
    return entry;
  }

  removePattern(id: string): void {
    if (!this.patterns.has(id)) {
      throw new Error(`Pattern '${id}' not found`);
    }
    this.patterns.delete(id);
    void this._emit("secrets.protected_paths.config.changed", { action: "remove", patternId: id });
  }

  disablePattern(id: string): void {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    p.enabled = false;
    void this._emit("secrets.protected_paths.config.changed", { action: "disable", patternId: id });
  }

  enablePattern(id: string): void {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    p.enabled = true;
    void this._emit("secrets.protected_paths.config.changed", { action: "enable", patternId: id });
  }

  listPatterns(): ProtectedPathPattern[] {
    return Array.from(this.patterns.values());
  }

  async importPatterns(path: string): Promise<void> {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ProtectedPathPattern[];
    for (const p of parsed) {
      if (!p.id || !p.pattern) continue;
      this.patterns.set(p.id, { ...p });
    }
    void this._emit("secrets.protected_paths.config.changed", {
      action: "import",
      count: parsed.length,
    });
  }

  async exportPatterns(path: string): Promise<void> {
    const data = Array.from(this.patterns.values());
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  }

  async loadFromDisk(): Promise<void> {
    if (!this.configPath || !existsSync(this.configPath)) return;
    await this.importPatterns(this.configPath);
  }

  async saveToDisk(): Promise<void> {
    if (!this.configPath) return;
    await this.exportPatterns(this.configPath);
  }

  getEnabledPatterns(): ProtectedPathPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.enabled);
  }

  private async _emit(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) return;
    const envelope: LocalBusEnvelope = {
      id: `protected-paths:${topic}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    };
    await this.bus.publish(envelope);
  }
}
