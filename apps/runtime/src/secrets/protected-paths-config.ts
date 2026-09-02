import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { DEFAULT_PATTERNS } from "./protected-paths-matching.js";
import type { ProtectedPathPattern } from "./protected-paths-types.js";

const BROAD_PATTERNS = new Set(["*", "**", "**/*", "*.*"]);
const DEFAULT_PATTERNS_BY_ID = new Map(DEFAULT_PATTERNS.map(pattern => [pattern.id, pattern]));

function assertSafePattern(pattern: string): void {
  if (pattern.trim() === "") {
    throw new Error("Pattern must not be empty");
  }
  if (BROAD_PATTERNS.has(pattern)) {
    throw new Error(`Pattern '${pattern}' is too broad and would match all paths`);
  }
}

function parsePattern(value: unknown, index: number): ProtectedPathPattern {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid protected path pattern at index ${index}: expected an object`);
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new Error(`Invalid protected path pattern at index ${index}: id must be non-empty`);
  }
  if (typeof candidate.pattern !== "string") {
    throw new Error(`Invalid protected path pattern '${candidate.id}': pattern must be a string`);
  }
  assertSafePattern(candidate.pattern);
  if (typeof candidate.description !== "string") {
    throw new Error(
      `Invalid protected path pattern '${candidate.id}': description must be a string`
    );
  }
  if (typeof candidate.enabled !== "boolean") {
    throw new Error(`Invalid protected path pattern '${candidate.id}': enabled must be a boolean`);
  }
  if (typeof candidate.isDefault !== "boolean") {
    throw new Error(
      `Invalid protected path pattern '${candidate.id}': isDefault must be a boolean`
    );
  }

  return {
    id: candidate.id,
    pattern: candidate.pattern,
    description: candidate.description,
    enabled: candidate.enabled,
    isDefault: candidate.isDefault,
  };
}

function assertCanonicalDefaultIdentity(pattern: ProtectedPathPattern): void {
  const defaultPattern = DEFAULT_PATTERNS_BY_ID.get(pattern.id);
  if (defaultPattern === undefined) {
    if (pattern.isDefault) {
      throw new Error(`Invalid protected path config: unknown default '${pattern.id}'`);
    }
    return;
  }
  if (
    !pattern.isDefault ||
    pattern.pattern !== defaultPattern.pattern ||
    pattern.description !== defaultPattern.description
  ) {
    throw new Error(`Invalid protected path config: cannot redefine default '${pattern.id}'`);
  }
}

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

  async addPattern(pattern: string, description: string): Promise<ProtectedPathPattern> {
    assertSafePattern(pattern);
    const id = `custom-${randomBytes(4).toString("hex")}`;
    const entry: ProtectedPathPattern = {
      id,
      pattern,
      description,
      enabled: true,
      isDefault: false,
    };
    await this._emit("secrets.protected_paths.config.changed", {
      action: "add",
      patternId: id,
      pattern,
    });
    if (this.patterns.has(id)) {
      throw new Error("Pattern changed before add");
    }
    this.patterns.set(id, entry);
    return entry;
  }

  async removePattern(id: string): Promise<void> {
    const pattern = this.patterns.get(id);
    if (!pattern) {
      throw new Error(`Pattern '${id}' not found`);
    }
    await this._emit("secrets.protected_paths.config.changed", {
      action: "remove",
      patternId: id,
    });
    if (this.patterns.get(id) !== pattern) {
      throw new Error("Pattern changed before remove");
    }
    this.patterns.delete(id);
  }

  async disablePattern(id: string): Promise<void> {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    await this._emit("secrets.protected_paths.config.changed", {
      action: "disable",
      patternId: id,
    });
    if (this.patterns.get(id) !== p) {
      throw new Error("Pattern changed before disable");
    }
    p.enabled = false;
  }

  async enablePattern(id: string): Promise<void> {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    await this._emit("secrets.protected_paths.config.changed", {
      action: "enable",
      patternId: id,
    });
    if (this.patterns.get(id) !== p) {
      throw new Error("Pattern changed before enable");
    }
    p.enabled = true;
  }

  listPatterns(): ProtectedPathPattern[] {
    return Array.from(this.patterns.values());
  }

  async importPatterns(path: string): Promise<void> {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid protected path config: expected an array");
    }
    const validated = parsed.map(parsePattern);
    const ids = new Set<string>();
    for (const pattern of validated) {
      assertCanonicalDefaultIdentity(pattern);
      if (ids.has(pattern.id)) {
        throw new Error(`Invalid protected path config: duplicate id '${pattern.id}'`);
      }
      ids.add(pattern.id);
    }
    await this._emit("secrets.protected_paths.config.changed", {
      action: "import",
      count: parsed.length,
    });
    for (const pattern of validated) {
      this.patterns.set(pattern.id, pattern);
    }
  }

  async exportPatterns(path: string): Promise<void> {
    const data = Array.from(this.patterns.values());
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tempPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tempPath, JSON.stringify(data, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(tempPath, path);
    } finally {
      rmSync(tempPath, { force: true });
    }
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
