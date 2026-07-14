import { describe, expect, it } from "bun:test";
import { RendererRegistry, DuplicateRendererError, RendererNotFoundError } from "../registry.js";
import type { RendererAdapter, RendererState } from "../adapter.js";
import type { RendererCapabilities } from "../capabilities.js";

function mockAdapter(id: string, version = "1.0.0"): RendererAdapter {
  const caps: RendererCapabilities = {
    gpuAccelerated: true,
    colorDepth: 24,
    ligatureSupport: true,
    maxDimensions: { cols: 200, rows: 50 },
    inputModes: ["raw", "cooked"],
    sixelSupport: false,
    italicSupport: true,
    strikethroughSupport: true,
  };

  return {
    id,
    version,
    init: async () => {},
    start: async () => {},
    stop: async () => {},
    bindStream: () => {},
    unbindStream: () => {},
    handleInput: () => {},
    resize: () => {},
    queryCapabilities: () => caps,
    getState: (): RendererState => "uninitialized",
    onCrash: () => {},
  };
}

// Traces to: FR-RND-003 (renderer registry)
describe("RendererRegistry", () => {
  it("registers and retrieves adapters", () => {
    const reg = new RendererRegistry();
    const adapter = mockAdapter("ghostty");
    reg.register(adapter);
    expect(reg.get("ghostty")).toBe(adapter);
  });

  it("lists all registered adapters", () => {
    const reg = new RendererRegistry();
    reg.register(mockAdapter("ghostty"));
    reg.register(mockAdapter("rio"));
    expect(reg.list().length).toBe(2);
  });

  it("throws on duplicate registration", () => {
    const reg = new RendererRegistry();
    reg.register(mockAdapter("ghostty"));
    expect(() => reg.register(mockAdapter("ghostty"))).toThrow(DuplicateRendererError);
  });

  it("returns undefined for unknown id", () => {
    const reg = new RendererRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("manages active renderer", () => {
    const reg = new RendererRegistry();
    const a = mockAdapter("ghostty");
    reg.register(a);
    expect(reg.getActive()).toBeUndefined();
    reg.setActive("ghostty");
    expect(reg.getActive()).toBe(a);
  });

  it("throws when setting active to unregistered id", () => {
    const reg = new RendererRegistry();
    expect(() => reg.setActive("nope")).toThrow(RendererNotFoundError);
  });

  it("clearActive is a no-op when none active", () => {
    const reg = new RendererRegistry();
    reg.clearActive(); // should not throw
    expect(reg.getActive()).toBeUndefined();
  });

  it("unregisters adapters", () => {
    const reg = new RendererRegistry();
    reg.register(mockAdapter("ghostty"));
    reg.setActive("ghostty");
    reg.unregister("ghostty");
    expect(reg.get("ghostty")).toBeUndefined();
    expect(reg.getActive()).toBeUndefined();
  });

  it("queries capabilities", () => {
    const reg = new RendererRegistry();
    reg.register(mockAdapter("ghostty"));
    const caps = reg.getCapabilities("ghostty");
    expect(caps.gpuAccelerated).toBe(true);
  });

  it("throws when querying capabilities for unknown id", () => {
    const reg = new RendererRegistry();
    expect(() => reg.getCapabilities("nope")).toThrow(RendererNotFoundError);
  });
});
