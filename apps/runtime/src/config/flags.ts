import type { SettingChangeEvent } from "./types.js";
import type { SettingsManager } from "./settings.js";
import { SETTINGS_SCHEMA } from "./schema.js";

// FR-008: Feature flag definition
/** Typed feature flag descriptor. */
export interface FeatureFlag<T = unknown> {
  key: string;
  defaultValue: T;
  description: string;
}

/**
 * High-performance feature flag registry.
 *
 * Flag reads use direct property access on a plain cache object —
 * zero allocation on the hot path.
 */
export class FlagRegistry {
  private readonly settings: SettingsManager;
  private readonly flags: Map<string, FeatureFlag> = new Map();

  /**
   * Plain-object cache: flag reads become `cache[key]` — direct property
   * access with no Map iterator, no object creation.
   */
  private cache: Record<string, unknown> = Object.create(null);

  /**
   * Pending values for restart-required flags that have been changed
   * but not yet applied (requires app restart).
   */
  private pending: Map<string, unknown> = new Map();

  /** True when at least one restart-required flag has a pending change. */
  private _pendingRestart = false;

  private unsubscribe: (() => void) | undefined;

  constructor(settings: SettingsManager) {
    this.settings = settings;
  }

  // ── Registration ────────────────────────────────────────────────────

  /** Register a feature flag definition. Throws on duplicate key. */
  register<T>(flag: FeatureFlag<T>): void {
    if (this.flags.has(flag.key)) {
      throw new Error(`Flag already registered: ${flag.key}`);
    }
    this.flags.set(flag.key, flag as FeatureFlag);
    // Populate cache immediately from current settings or default.
    this.cache[flag.key] = this.settings.get(flag.key) ?? flag.defaultValue;
  }

  // ── Init / teardown ─────────────────────────────────────────────────

  /** Subscribe to settings changes and hydrate cache. */
  init(): void {
    // Hydrate cache for all registered flags.
    for (const [key, flag] of this.flags) {
      this.cache[key] = this.settings.get(key) ?? flag.defaultValue;
    }

    // Listen for future changes.
    this.unsubscribe = this.settings.onSettingChanged((event: SettingChangeEvent) => {
      this.handleChange(event);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  // ── Read API (hot path — zero allocation) ───────────────────────────

  // FR-008: Zero-allocation flag read
  /**
   * Read a flag value. Direct property access on a plain object —
   * no Map lookup, no iterator, no object creation.
   *
   * @throws if the key is not registered.
   */
  get<T>(key: string): T {
    if (!this.flags.has(key)) {
      throw new Error(`Unknown flag: ${key}`);
    }
    return this.cache[key] as T;
  }

  /** Return all flag values. Allocates a new object — not for hot path. */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of this.flags.keys()) {
      result[key] = this.cache[key];
    }
    return result;
  }

  // ── Pending restart API ─────────────────────────────────────────────

  /** True if any restart-required flag has an uncommitted change. */
  get pendingRestart(): boolean {
    return this._pendingRestart;
  }

  /**
   * For restart-required flags with pending changes, return current
   * and pending values. Returns null if the flag has no pending change.
   */
  getPending<T>(key: string): { current: T; pending: T } | null {
    if (!this.pending.has(key)) {
      return null;
    }
    return {
      current: this.cache[key] as T,
      pending: this.pending.get(key) as T,
    };
  }

  // ── Convenience typed accessors ─────────────────────────────────────

  // FR-009: Typed renderer_engine accessor
  /** Convenience accessor for the renderer_engine flag. */
  getRendererEngine(): "ghostty" | "rio" {
    return this.get<"ghostty" | "rio">("renderer_engine");
  }

  // ── Internal ────────────────────────────────────────────────────────

  private handleChange(event: SettingChangeEvent): void {
    if (!this.flags.has(event.key)) {
      return; // Not a registered flag — ignore.
    }

    const def = SETTINGS_SCHEMA[event.key];
    const requiresRestart = def?.reloadPolicy === "restart";

    if (requiresRestart) {
      // Check if pending value matches current cached value (revert case).
      if (event.newValue === this.cache[event.key]) {
        this.pending.delete(event.key);
      } else {
        this.pending.set(event.key, event.newValue);
      }
      this._pendingRestart = this.pending.size > 0;
      // Do NOT update cache — old value stays active until restart.
    } else {
      // Hot-reloadable: update cache immediately.
      this.cache[event.key] = event.newValue;
    }
  }
}

// ── Built-in flag definitions ───────────────────────────────────────────

// FR-009: renderer_engine feature flag
export const RENDERER_ENGINE_FLAG: FeatureFlag<"ghostty" | "rio"> = {
  key: "renderer_engine",
  defaultValue: "ghostty",
  description: "Terminal renderer engine. Changing requires restart (reloadPolicy=restart).",
};
