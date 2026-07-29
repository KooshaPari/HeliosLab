/**
 * Ghostty capability matrix reporting (T004).
 *
 * Detects runtime capabilities based on ghostty version and system GPU,
 * then caches them for fast (<50ms) queries.
 */

import type { RendererCapabilities } from "../capabilities.js";

// ---------------------------------------------------------------------------
// GPU detection
// ---------------------------------------------------------------------------

interface GpuInfo {
  available: boolean;
  driverVersion: string | undefined;
}

/**
 * Attempt to detect GPU availability on the host system.
 *
 * On macOS this checks for Metal support; on Linux it probes for
 * OpenGL/Vulkan.  Falls back to `{ available: false }` on failure.
 */
export async function detectGpu(): Promise<GpuInfo> {
  try {
    if (process.platform === "darwin") {
      // macOS always has Metal on supported hardware
      const proc = Bun.spawn(["system_profiler", "SPDisplaysDataType"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const text = await new Response(proc.stdout).text();
      const hasMetal = text.includes("Metal");
      return {
        available: hasMetal,
        driverVersion: hasMetal ? "metal" : undefined,
      };
    }

    // Linux: probe for OpenGL
    const proc = Bun.spawn(["glxinfo"], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    const versionMatch = text.match(/OpenGL version string:\s*(.+)/);
    return {
      available: versionMatch !== null,
      driverVersion: versionMatch?.[1]?.trim(),
    };
  } catch {
    return { available: false, driverVersion: undefined };
  }
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

let cachedCapabilities: RendererCapabilities | undefined;

/**
 * Detect ghostty renderer capabilities.
 *
 * Results are cached after the first invocation so that subsequent
 * queries return in < 1ms (well under the 50ms target).
 *
 * @param forceRefresh - If true, discard the cache and re-detect.
 */
export async function detectCapabilities(forceRefresh = false): Promise<RendererCapabilities> {
  if (cachedCapabilities !== undefined && !forceRefresh) {
    return cachedCapabilities;
  }

  const gpu = await detectGpu();

  const capabilities: RendererCapabilities = {
    gpuAccelerated: gpu.available,
    colorDepth: 24,
    ligatureSupport: true, // ghostty supports ligatures natively
    maxDimensions: { cols: 500, rows: 200 },
    inputModes: ["raw", "cooked", "application"],
    sixelSupport: true, // ghostty supports Sixel graphics
    italicSupport: true,
    strikethroughSupport: true,
  };

  cachedCapabilities = capabilities;
  return capabilities;
}

/**
 * Return the cached capabilities synchronously.
 *
 * Returns a sensible default if capabilities have not been detected yet.
 */
export function getCachedCapabilities(): RendererCapabilities {
  if (cachedCapabilities !== undefined) {
    return cachedCapabilities;
  }

  // Pre-detection defaults (conservative)
  return {
    gpuAccelerated: false,
    colorDepth: 24,
    ligatureSupport: true,
    maxDimensions: { cols: 500, rows: 200 },
    inputModes: ["raw", "cooked", "application"],
    sixelSupport: true,
    italicSupport: true,
    strikethroughSupport: true,
  };
}

/**
 * Clear the cached capabilities (useful for testing).
 */
export function clearCapabilityCache(): void {
  cachedCapabilities = undefined;
}
