import { describe, expect, it } from "bun:test";
import { compareCapabilities } from "../capabilities.js";
import type { RendererCapabilities } from "../capabilities.js";

function baseCaps(): RendererCapabilities {
  return {
    gpuAccelerated: true,
    colorDepth: 24,
    ligatureSupport: true,
    maxDimensions: { cols: 200, rows: 50 },
    inputModes: ["raw", "cooked"],
    sixelSupport: false,
    italicSupport: true,
    strikethroughSupport: true,
  };
}

// Traces to: FR-RND-007 (capability matrix reporting)
describe("compareCapabilities", () => {
  it("reports equal for identical capabilities", () => {
    const diff = compareCapabilities(baseCaps(), baseCaps());
    expect(diff.equal).toBe(true);
    expect(diff.differences.length).toBe(0);
  });

  it("detects scalar differences", () => {
    const a = baseCaps();
    const b = { ...baseCaps(), gpuAccelerated: false, colorDepth: 8 as const };
    const diff = compareCapabilities(a, b);
    expect(diff.equal).toBe(false);
    expect(diff.differences.length).toBe(2);
    const fields = diff.differences.map(d => d.field);
    expect(fields).toContain("gpuAccelerated");
    expect(fields).toContain("colorDepth");
  });

  it("detects maxDimensions difference", () => {
    const a = baseCaps();
    const b = { ...baseCaps(), maxDimensions: { cols: 100, rows: 50 } };
    const diff = compareCapabilities(a, b);
    expect(diff.equal).toBe(false);
    expect(diff.differences.some(d => d.field === "maxDimensions")).toBe(true);
  });

  it("detects inputModes difference (order independent)", () => {
    const a = baseCaps();
    const b = { ...baseCaps(), inputModes: ["application" as const] };
    const diff = compareCapabilities(a, b);
    expect(diff.equal).toBe(false);
    expect(diff.differences.some(d => d.field === "inputModes")).toBe(true);
  });

  it("treats same inputModes in different order as equal", () => {
    const a = baseCaps();
    const b = {
      ...baseCaps(),
      inputModes: ["cooked" as const, "raw" as const],
    };
    const diff = compareCapabilities(a, b);
    expect(diff.differences.some(d => d.field === "inputModes")).toBe(false);
  });
});
