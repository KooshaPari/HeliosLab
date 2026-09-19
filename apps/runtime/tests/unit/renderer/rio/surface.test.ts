import { describe, expect, it } from "bun:test";
import { RioSurface } from "../../../../src/renderer/rio/surface";

function fakeSurface(bounds = { x: 0, y: 0, width: 800, height: 600 }) {
	return { bounds, pid: 4242 } as never;
}

describe("RioSurface", () => {
	it("starts unbound with no surface or pid", () => {
		const s = new RioSurface();
		expect(s.isBound()).toBe(false);
		expect(s.getSurface()).toBeUndefined();
		expect(s.getPid()).toBeUndefined();
	});

	it("binds a surface and pid", () => {
		const s = new RioSurface();
		const surface = fakeSurface();
		s.bind(surface, 1234);
		expect(s.isBound()).toBe(true);
		expect(s.getSurface()).toBe(surface);
		expect(s.getPid()).toBe(1234);
	});

	it("unbinds and clears state", () => {
		const s = new RioSurface();
		s.bind(fakeSurface(), 7);
		s.unbind();
		expect(s.isBound()).toBe(false);
		expect(s.getSurface()).toBeUndefined();
		expect(s.getPid()).toBeUndefined();
	});

	it("resize replaces bounds when bound", () => {
		const s = new RioSurface();
		s.bind(fakeSurface(), 7);
		s.resize({ x: 10, y: 20, width: 300, height: 200 });
		expect(s.getSurface()).toMatchObject({
			bounds: { x: 10, y: 20, width: 300, height: 200 },
		});
	});

	it("resize is a no-op when unbound", () => {
		const s = new RioSurface();
		expect(() => s.resize({ x: 1, y: 1, width: 10, height: 10 })).not.toThrow();
		expect(s.getSurface()).toBeUndefined();
	});

	it("resize ignores zero and negative sizes", () => {
		const s = new RioSurface();
		s.bind(fakeSurface(), 7);
		s.resize({ x: 0, y: 0, width: 0, height: 100 });
		expect(s.getSurface()).toMatchObject({
			bounds: { x: 0, y: 0, width: 800, height: 600 },
		});
		s.resize({ x: 0, y: 0, width: 100, height: -1 });
		expect(s.getSurface()).toMatchObject({
			bounds: { x: 0, y: 0, width: 800, height: 600 },
		});
	});
});
