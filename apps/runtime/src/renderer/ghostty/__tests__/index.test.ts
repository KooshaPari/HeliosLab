/**
 * Unit tests for ghostty registration and exports (T005).
 */

import { describe, test, expect } from "bun:test";
import { RendererRegistry } from "../../registry.js";
import { GhosttyBackend, isGhosttyAvailable } from "../index.js";

describe("Ghostty Module Exports", () => {
  test("GhosttyBackend is exported and constructable", () => {
    const backend = new GhosttyBackend("1.0.0");
    expect(backend.id).toBe("ghostty");
    expect(backend.version).toBe("1.0.0");
  });

  test("isGhosttyAvailable returns boolean", async () => {
    const result = await isGhosttyAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("manual registration works", () => {
    const registry = new RendererRegistry();
    const backend = new GhosttyBackend("1.0.0-test");
    registry.register(backend);

    expect(registry.get("ghostty")).toBe(backend);
    expect(registry.list()).toHaveLength(1);
    expect(registry.getCapabilities("ghostty")).toBeDefined();
  });

  test("registration skips gracefully when binary not found", async () => {
    // isGhosttyAvailable with a bad path should return false
    const available = await isGhosttyAvailable("/nonexistent/ghostty");
    expect(available).toBe(false);
  });
});
