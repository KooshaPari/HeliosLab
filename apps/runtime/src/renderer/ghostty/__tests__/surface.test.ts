/**
 * Unit tests for GhosttySurface (T003).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GhosttySurface } from "../surface.js";
import type { RenderSurface } from "../../adapter.js";

const TEST_SURFACE: RenderSurface = {
  windowId: "win-1",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};

describe("GhosttySurface", () => {
  let surface: GhosttySurface;

  beforeEach(() => {
    surface = new GhosttySurface();
  });

  test("initial state is unbound", () => {
    expect(surface.isBound()).toBe(false);
    expect(surface.getSurface()).toBeUndefined();
  });

  test("bind sets bound state", () => {
    surface.bind(TEST_SURFACE, 1234);
    expect(surface.isBound()).toBe(true);
    expect(surface.getSurface()).toEqual(TEST_SURFACE);
  });

  test("unbind clears state", () => {
    surface.bind(TEST_SURFACE, 1234);
    surface.unbind();
    expect(surface.isBound()).toBe(false);
    expect(surface.getSurface()).toBeUndefined();
  });

  test("unbind when not bound is a no-op", () => {
    surface.unbind(); // Should not throw
    expect(surface.isBound()).toBe(false);
  });

  test("double bind replaces previous binding", () => {
    surface.bind(TEST_SURFACE, 1234);
    const newSurface: RenderSurface = {
      windowId: "win-2",
      bounds: { x: 10, y: 10, width: 800, height: 600 },
    };
    surface.bind(newSurface, 5678);
    expect(surface.getSurface()).toEqual(newSurface);
  });

  test("resize updates bounds", () => {
    surface.bind(TEST_SURFACE, 1234);
    const newBounds = { x: 0, y: 0, width: 1024, height: 768 };
    surface.resize(newBounds);
    expect(surface.getSurface()?.bounds).toEqual(newBounds);
  });

  test("resize when not bound is a no-op", () => {
    surface.resize({ x: 0, y: 0, width: 100, height: 100 }); // Should not throw
  });

  test("zero-size surface is handled gracefully", () => {
    const minimizedSurface: RenderSurface = {
      windowId: "win-1",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    surface.bind(minimizedSurface, 1234);
    expect(surface.isBound()).toBe(true);
  });
});
