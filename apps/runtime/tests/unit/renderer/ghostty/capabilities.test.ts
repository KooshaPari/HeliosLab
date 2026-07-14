/**
 * FR-HELIOS-049: Ghostty Capability Detection Tests
 * Verifies: FR-GHT-006 (Capability matrix reporting), FR-MVP-017 (Hardware capability detection)
 */
import { describe, test, expect, afterEach, mock, beforeEach } from "bun:test";
import {
  detectCapabilities,
  getCachedCapabilities,
  clearCapabilityCache,
} from "../../../../src/renderer/ghostty/capabilities.js";

// Mock Bun.spawn to avoid slow system_profiler calls in tests
const originalSpawn = Bun.spawn;
beforeEach(() => {
  (Bun as any).spawn = mock((..._args: any[]) => {
    // Return a fake process with stdout that has Metal info
    const encoder = new TextEncoder();
    const data = encoder.encode("Metal: Supported");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    return { stdout: stream, stderr: null, exitCode: Promise.resolve(0) };
  });
});

afterEach(() => {
  clearCapabilityCache();
  (Bun as any).spawn = originalSpawn;
});

describe("Capability detection", () => {
  test("getCachedCapabilities returns defaults before detection", () => {
    const caps = getCachedCapabilities();
    expect(caps).toBeDefined();
    expect(caps.gpuAccelerated).toBe(false); // Conservative default
    expect(caps.colorDepth).toBe(24);
    expect(caps.ligatureSupport).toBe(true);
    expect(caps.sixelSupport).toBe(true);
    expect(Array.isArray(caps.inputModes)).toBe(true);
  });

  test("detectCapabilities returns capabilities object", async () => {
    const caps = await detectCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.gpuAccelerated).toBe("boolean");
    expect(caps.colorDepth).toBe(24);
    expect(caps.maxDimensions.cols).toBe(500);
    expect(caps.maxDimensions.rows).toBe(200);
  });

  test("detectCapabilities caches result", async () => {
    const _caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities();
    // Same reference from cache
    expect(caps1).toBe(caps2);
  });

  test("detectCapabilities forceRefresh re-detects", async () => {
    const _caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities(true);
    // Both valid but may be different objects
    expect(caps2).toBeDefined();
    expect(typeof caps2.gpuAccelerated).toBe("boolean");
  });

  test("clearCapabilityCache clears cache", async () => {
    await detectCapabilities();
    clearCapabilityCache();
    // getCachedCapabilities returns defaults after clear
    const caps = getCachedCapabilities();
    expect(caps.gpuAccelerated).toBe(false);
  });

  test("getCachedCapabilities returns detected caps after detection", async () => {
    const detected = await detectCapabilities();
    const cached = getCachedCapabilities();
    expect(cached).toBe(detected);
  });
});
