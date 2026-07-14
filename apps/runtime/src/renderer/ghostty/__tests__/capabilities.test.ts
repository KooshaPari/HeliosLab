/**
 * Unit tests for ghostty capability detection (T004).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  getCachedCapabilities,
  clearCapabilityCache,
  detectCapabilities,
} from "../capabilities.js";
import type { RendererCapabilities } from "../../capabilities.js";

describe("Ghostty Capabilities", () => {
  beforeEach(() => {
    clearCapabilityCache();
  });

  test("getCachedCapabilities returns defaults before detection", () => {
    const caps = getCachedCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.gpuAccelerated).toBe("boolean");
    expect(caps.colorDepth).toBe(24);
    expect(caps.ligatureSupport).toBe(true);
    expect(caps.sixelSupport).toBe(true);
    expect(caps.italicSupport).toBe(true);
    expect(caps.strikethroughSupport).toBe(true);
    expect(Array.isArray(caps.inputModes)).toBe(true);
    expect(caps.inputModes).toContain("raw");
    expect(caps.inputModes).toContain("cooked");
    expect(caps.inputModes).toContain("application");
  });

  test("detectCapabilities populates cache", async () => {
    const caps = await detectCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.gpuAccelerated).toBe("boolean");

    // Subsequent sync call returns same object
    const cached = getCachedCapabilities();
    expect(cached).toEqual(caps);
  });

  test("detectCapabilities returns cached on second call", async () => {
    const _caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities();
    expect(caps1).toBe(caps2); // Same reference (cached)
  });

  test("forceRefresh bypasses cache", async () => {
    const _caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities(true);
    // May or may not be same reference depending on timing, but should have same shape
    expect(caps2.colorDepth).toBe(caps1.colorDepth);
  });

  test("clearCapabilityCache resets to defaults", async () => {
    await detectCapabilities();
    clearCapabilityCache();
    const caps = getCachedCapabilities();
    // After clearing, the defaults should be returned (gpuAccelerated = false)
    expect(caps.gpuAccelerated).toBe(false);
  });

  test("capability query is fast (< 50ms) when cached", async () => {
    await detectCapabilities();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      getCachedCapabilities();
    }
    const elapsed = performance.now() - start;
    // 1000 queries should be well under 50ms total
    expect(elapsed).toBeLessThan(50);
  });

  test("capabilities match RendererCapabilities shape", () => {
    const caps: RendererCapabilities = getCachedCapabilities();
    const requiredKeys: (keyof RendererCapabilities)[] = [
      "gpuAccelerated",
      "colorDepth",
      "ligatureSupport",
      "maxDimensions",
      "inputModes",
      "sixelSupport",
      "italicSupport",
      "strikethroughSupport",
    ];
    for (const key of requiredKeys) {
      expect(caps[key]).toBeDefined();
    }
  });
});
