/**
 * FR-HELIOS-057: Renderer Capability Query Tests
 * Verifies: FR-RND-007 (Capability matrix), FR-GHT-006 (Ghostty capabilities), FR-RIO-006 (Rio capabilities)
 * Traces to: FR-MVP-015 (local Apple), FR-MVP-016 (local NVIDIA), FR-MVP-017 (detect hardware)
 */
import { describe, expect, it } from "bun:test";
import { queryCapabilities, compareCapabilities } from "../../../src/renderer/capabilities.js";
import type { RendererCapabilities } from "../../../src/renderer/capabilities.js";
import { MockGhosttyAdapter, MockRioAdapter } from "../../helpers/mock_adapter.js";

const CAPS_A: RendererCapabilities = {
  gpuAccelerated: true,
  colorDepth: 24,
  ligatureSupport: true,
  maxDimensions: { cols: 200, rows: 50 },
  inputModes: ["raw", "cooked"],
  sixelSupport: true,
  italicSupport: true,
  strikethroughSupport: true,
};

const CAPS_B: RendererCapabilities = {
  gpuAccelerated: false,
  colorDepth: 16,
  ligatureSupport: false,
  maxDimensions: { cols: 100, rows: 25 },
  inputModes: ["raw"],
  sixelSupport: false,
  italicSupport: false,
  strikethroughSupport: false,
};

describe("queryCapabilities", () => {
  it("returns capabilities from adapter", () => {
    const adapter = new MockGhosttyAdapter();
    const caps = queryCapabilities(adapter);
    expect(caps.gpuAccelerated).toBe(true);
  });

  it("returns capabilities in < 50ms (NFR-010-003)", () => {
    const adapter = new MockGhosttyAdapter();
    const start = performance.now();
    queryCapabilities(adapter);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

describe("compareCapabilities", () => {
  it("returns equal for identical capabilities", () => {
    const diff = compareCapabilities(CAPS_A, CAPS_A);
    expect(diff.equal).toBe(true);
    expect(diff.differences.length).toBe(0);
  });

  it("detects scalar differences", () => {
    const diff = compareCapabilities(CAPS_A, CAPS_B);
    expect(diff.equal).toBe(false);
    expect(diff.differences.some(d => d.field === "gpuAccelerated")).toBe(true);
    expect(diff.differences.some(d => d.field === "colorDepth")).toBe(true);
    expect(diff.differences.some(d => d.field === "ligatureSupport")).toBe(true);
  });

  it("detects maxDimensions differences", () => {
    const diff = compareCapabilities(CAPS_A, CAPS_B);
    expect(diff.differences.some(d => d.field === "maxDimensions")).toBe(true);
  });

  it("detects inputModes differences", () => {
    const diff = compareCapabilities(CAPS_A, CAPS_B);
    expect(diff.differences.some(d => d.field === "inputModes")).toBe(true);
  });

  it("order-independent inputModes comparison", () => {
    const a = {
      ...CAPS_A,
      inputModes: ["cooked", "raw"] as ("raw" | "cooked" | "application")[],
    };
    const b = {
      ...CAPS_A,
      inputModes: ["raw", "cooked"] as ("raw" | "cooked" | "application")[],
    };
    const diff = compareCapabilities(a, b);
    expect(diff.equal).toBe(true);
  });

  it("compares ghostty vs rio capabilities", () => {
    const g = new MockGhosttyAdapter();
    const r = new MockRioAdapter();
    const diff = compareCapabilities(g.queryCapabilities(), r.queryCapabilities());
    expect(diff.differences.some(d => d.field === "sixelSupport")).toBe(true);
  });
});
