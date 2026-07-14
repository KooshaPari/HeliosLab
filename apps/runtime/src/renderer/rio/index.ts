/**
 * Rio renderer registration with feature flag gate.
 *
 * When the feature flag is disabled (default), this module returns
 * immediately with zero runtime cost — no dynamic imports, no object
 * allocation, no process spawning.
 */

import type { RendererRegistry } from "../registry.js";
import type { RioBackend } from "./backend.js";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * Minimal app-config shape needed by the rio gate.
 * The real AppConfig lives elsewhere; we only require the slice we read.
 */
export interface RioFeatureFlagConfig {
  featureFlags?: {
    rioRenderer?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Feature-flag utility
// ---------------------------------------------------------------------------

/**
 * Check whether the rio renderer is enabled in the given config.
 *
 * Returns `false` when the key is missing or explicitly set to `false`.
 */
export function isRioEnabled(config: RioFeatureFlagConfig): boolean {
  return config.featureFlags?.rioRenderer === true;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the `rio` binary is available on the system PATH.
 */
export async function detectRioBinary(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "rio"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the rio renderer backend if the feature flag is enabled and
 * the rio binary is available.
 *
 * Zero-cost when the flag is off: no dynamic import, no object creation.
 */
export async function registerRio(
  registry: RendererRegistry,
  config: RioFeatureFlagConfig
): Promise<void> {
  if (!isRioEnabled(config)) {
    // Zero-cost path: do nothing.
    if (typeof console !== "undefined") {
      console.debug("Rio renderer: disabled by feature flag");
    }
    return;
  }

  // Feature flag is on — dynamically load the backend module.
  let backendModule: typeof import("./backend.js");
  try {
    backendModule = await import("./backend.js");
  } catch {
    console.error("Rio renderer: failed to load backend module", err);
    return;
  }

  // Detect binary availability.
  const available = await detectRioBinary();
  if (!available) {
    console.warn("Rio renderer: feature flag is enabled but rio binary not found on PATH");
    return;
  }

  // Create and register.
  const backend = new backendModule.RioBackend();
  backend.setRegistry(registry);
  registry.register(backend);
}

// ---------------------------------------------------------------------------
// Feature flag toggle handler (T008)
// ---------------------------------------------------------------------------

export type ToggleEvent =
  | { type: "renderer.rio.disabled" }
  | { type: "renderer.rio.enabled" }
  | { type: "renderer.rio.toggle_queued" };

/**
 * Handle a runtime feature flag toggle for the rio renderer.
 *
 * When disabling: if rio is active, switch to ghostty first, then unregister.
 * When enabling: register rio but do NOT automatically switch to it.
 *
 * Returns an array of events describing what happened.
 */
export async function handleRioToggle(
  registry: RendererRegistry,
  newEnabled: boolean,
  config: RioFeatureFlagConfig
): Promise<ToggleEvent[]> {
  const events: ToggleEvent[] = [];

  if (!newEnabled) {
    // Disabling rio.
    const rioAdapter = registry.get("rio") as RioBackend | undefined;
    if (rioAdapter) {
      // If rio is active, switch to ghostty first.
      const active = registry.getActive();
      if (active && active.id === "rio") {
        const _ghostty = registry.get("ghostty");
        if (ghostty) {
          // Init ghostty if needed.
          const ghosttyState = ghostty.getState();
          if (
            ghosttyState === "uninitialized" ||
            ghosttyState === "stopped" ||
            ghosttyState === "errored"
          ) {
            const flagConfig = config.featureFlags;
            await ghostty.init({
              gpuAcceleration: flagConfig?.rioRenderer ?? false,
              colorDepth: 24,
              maxDimensions: { cols: 200, rows: 50 },
            });
          }
          registry.setActive("ghostty");
        }
        await rioAdapter.stop();
      }

      rioAdapter.setDisabled();
      try {
        registry.unregister("rio");
      } catch {
        // already unregistered
      }
    }
    events.push({ type: "renderer.rio.disabled" });
  } else {
    // Enabling rio.
    const existing = registry.get("rio");
    if (existing) {
      // Already registered, just re-enable.
      (existing as RioBackend).setEnabled();
    } else {
      // Dynamically import and register.
      const available = await detectRioBinary();
      if (!available) {
        console.warn("Rio renderer: feature flag enabled but rio binary not found");
        events.push({ type: "renderer.rio.enabled" });
        return events;
      }

      let backendModule: typeof import("./backend.js");
      try {
        backendModule = await import("./backend.js");
      } catch {
        console.error("Rio renderer: failed to load backend module during toggle");
        events.push({ type: "renderer.rio.enabled" });
        return events;
      }

      const backend = new backendModule.RioBackend();
      backend.setRegistry(registry);
      registry.register(backend);
    }
    // Do NOT automatically switch to rio.
    events.push({ type: "renderer.rio.enabled" });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Feature flag toggle queue (serializes rapid toggles)
// ---------------------------------------------------------------------------

export class RioToggleQueue {
  private _processing = false;
  private _pending: Array<{
    enabled: boolean;
    resolve: (events: ToggleEvent[]) => void;
    reject: (err: Error) => void;
  }> = [];
  private _registry: RendererRegistry;
  private _config: RioFeatureFlagConfig;

  constructor(registry: RendererRegistry, config: RioFeatureFlagConfig) {
    this._registry = registry;
    this._config = config;
  }

  async enqueue(enabled: boolean): Promise<ToggleEvent[]> {
    return new Promise<ToggleEvent[]>((resolve, reject) => {
      this._pending.push({ enabled, resolve, reject });
      if (!this._processing) {
        this._processQueue().catch(() => {});
      }
    });
  }

  private async _processQueue(): Promise<void> {
    this._processing = true;
    while (this._pending.length > 0) {
      // If multiple toggles pending, skip to the last one (final state).
      const item = this._pending.length > 1 ? this._drainToLast() : this._pending.shift()!;

      try {
        const events = await handleRioToggle(this._registry, item.enabled, this._config);
        item.resolve(events);
      } catch {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    this._processing = false;
  }

  private _drainToLast(): {
    enabled: boolean;
    resolve: (events: ToggleEvent[]) => void;
    reject: (err: Error) => void;
  } {
    // Resolve all but last with queued event.
    const last = this._pending[this._pending.length - 1]!;
    for (let i = 0; i < this._pending.length - 1; i++) {
      this._pending[i]!.resolve([{ type: "renderer.rio.toggle_queued" }]);
    }
    this._pending = [];
    return last;
  }

  get pendingCount(): number {
    return this._pending.length;
  }
}
