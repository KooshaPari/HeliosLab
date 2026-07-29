/**
 * Ghostty renderer backend module entry point (T005).
 *
 * Provides registration, export, and binary detection for the ghostty
 * renderer backend.
 */

import type { RendererRegistry } from "../registry.js";
import { GhosttyBackend } from "./backend.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { GhosttyBackend } from "./backend.js";
export {
  GhosttyNotInitializedError,
  GhosttyNotRunningError,
  GhosttyAlreadyInitializedError,
} from "./backend.js";
export { GhosttyProcess, GhosttyBinaryNotFoundError, GhosttyProcessError } from "./process.js";
export type { GhosttyOptions } from "./process.js";
export { GhosttySurface, SurfaceBindingError } from "./surface.js";
export type { GpuRenderingMode, GpuSurfaceStatus, SurfaceEventHandler } from "./surface.js";
export {
  detectCapabilities,
  getCachedCapabilities,
  clearCapabilityCache,
  detectGpu,
} from "./capabilities.js";
export { GhosttyMetrics } from "./metrics.js";
export type {
  FrameSample,
  InputLatencySample,
  MetricsSnapshot,
  MetricsConfig,
  MetricsPublisher,
} from "./metrics.js";
export { GhosttyInputRelay, InputRelayError } from "./input.js";
export type { PtyWriter, GhosttyInputEvent, InputEventListener } from "./input.js";

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Check whether the ghostty binary is available on the system PATH.
 *
 * @param binaryPath - Override the binary name/path. Defaults to "ghostty".
 * @returns `true` if the binary is found.
 */
export async function isGhosttyAvailable(binaryPath = "ghostty"): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", binaryPath], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Detect the installed ghostty version string.
 *
 * @returns The version string, or "unknown" if detection fails.
 */
export async function detectGhosttyVersion(binaryPath = "ghostty"): Promise<string> {
  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Create a {@link GhosttyBackend} and register it with the given registry.
 *
 * If ghostty is not installed, logs a warning and returns without
 * registering (does **not** throw).
 *
 * @param registry - The renderer registry to register with.
 * @param binaryPath - Optional override for the ghostty binary path.
 */
export async function registerGhostty(
  registry: RendererRegistry,
  binaryPath?: string | undefined
): Promise<void> {
  const available = await isGhosttyAvailable(binaryPath);

  if (!available) {
    console.warn("[ghostty] Ghostty binary not found; skipping registration.");
    return;
  }

  const version = await detectGhosttyVersion(binaryPath);
  const backend = new GhosttyBackend(version);
  registry.register(backend);
}
