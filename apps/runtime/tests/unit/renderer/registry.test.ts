/**
 * FR-HELIOS-059: Renderer Registry Tests
 * Verifies: FR-RND-003 (Renderer registry with capability metadata), FR-RND-008 (Exactly one active renderer)
 * Traces to: FR-MVP-007 (ANSI color/cursor), FR-MVP-017 (detect hardware)
 */
import { describe, expect, it } from "bun:test";
import {
  RendererRegistry,
  DuplicateRendererError,
  RendererNotFoundError,
} from "../../../src/renderer/registry.js";
import { MockGhosttyAdapter, MockRioAdapter } from "../../helpers/mock_adapter.js";

describe("RendererRegistry", () => {
  it("registers an adapter", () => {
    const reg = new RendererRegistry();
    const adapter = new MockGhosttyAdapter();
    reg.register(adapter);
    expect(reg.get("ghostty")).toBe(adapter);
  });

  it("throws DuplicateRendererError on duplicate registration", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    expect(() => reg.register(new MockGhosttyAdapter())).toThrow(DuplicateRendererError);
  });

  it("lists all registered adapters", () => {
    const reg = new RendererRegistry();
    const g = new MockGhosttyAdapter();
    const r = new MockRioAdapter();
    reg.register(g);
    reg.register(r);
    const list = reg.list();
    expect(list.length).toBe(2);
    expect(list.map(a => a.id).sort()).toEqual(["ghostty", "rio"]);
  });

  it("returns undefined for unregistered ID", () => {
    const reg = new RendererRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("unregisters an adapter", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    reg.unregister("ghostty");
    expect(reg.get("ghostty")).toBeUndefined();
    expect(reg.list().length).toBe(0);
  });

  it("throws RendererNotFoundError on unregister of unknown ID", () => {
    const reg = new RendererRegistry();
    expect(() => reg.unregister("nope")).toThrow(RendererNotFoundError);
  });

  it("sets and gets active renderer", () => {
    const reg = new RendererRegistry();
    const g = new MockGhosttyAdapter();
    reg.register(g);
    reg.setActive("ghostty");
    expect(reg.getActive()).toBe(g);
  });

  it("enforces single-active: setActive replaces previous", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    reg.register(new MockRioAdapter());
    reg.setActive("ghostty");
    reg.setActive("rio");
    expect(reg.getActive()?.id).toBe("rio");
  });

  it("throws RendererNotFoundError on setActive with unknown ID", () => {
    const reg = new RendererRegistry();
    expect(() => reg.setActive("nope")).toThrow(RendererNotFoundError);
  });

  it("clearActive removes active selection", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    reg.setActive("ghostty");
    reg.clearActive();
    expect(reg.getActive()).toBeUndefined();
  });

  it("getActive returns undefined when none active", () => {
    const reg = new RendererRegistry();
    expect(reg.getActive()).toBeUndefined();
  });

  it("unregistering active adapter clears active", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    reg.setActive("ghostty");
    reg.unregister("ghostty");
    expect(reg.getActive()).toBeUndefined();
  });

  it("getCapabilities returns capabilities", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    const caps = reg.getCapabilities("ghostty");
    expect(caps.gpuAccelerated).toBe(true);
  });

  it("throws RendererNotFoundError for getCapabilities on unknown ID", () => {
    const reg = new RendererRegistry();
    expect(() => reg.getCapabilities("nope")).toThrow(RendererNotFoundError);
  });

  it("registers mock ghostty and rio without interface modification (SC-010-002)", () => {
    const reg = new RendererRegistry();
    reg.register(new MockGhosttyAdapter());
    reg.register(new MockRioAdapter());
    expect(reg.list().length).toBe(2);
  });
});
