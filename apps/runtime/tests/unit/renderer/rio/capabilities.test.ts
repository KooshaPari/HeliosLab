import { describe, expect, it } from "bun:test";
import { RioCapabilities } from "../../../../src/renderer/rio/capabilities";

describe("RioCapabilities", () => {
	it("returns defaults before detection", () => {
		const caps = new RioCapabilities();
		const snapshot = caps.get();
		expect(snapshot.gpuAccelerated).toBe(false);
		expect(snapshot.colorDepth).toBe(24);
		expect(snapshot.maxDimensions).toEqual({ cols: 500, rows: 200 });
		expect(caps.isDetected()).toBe(false);
	});

	it("detects from config and caches", () => {
		const caps = new RioCapabilities();
		caps.detect({
			gpuAcceleration: true,
			colorDepth: 8,
			maxDimensions: { cols: 1000, rows: 400 },
		} as never);
		expect(caps.isDetected()).toBe(true);
		const snapshot = caps.get();
		expect(snapshot.gpuAccelerated).toBe(true);
		expect(snapshot.colorDepth).toBe(8);
		expect(snapshot.maxDimensions).toEqual({ cols: 500, rows: 200 });
	});

	it("clamps oversized dimensions to rio limits", () => {
		const caps = new RioCapabilities();
		caps.detect({
			gpuAcceleration: false,
			colorDepth: 24,
			maxDimensions: { cols: 9999, rows: 9999 },
		} as never);
		expect(caps.get().maxDimensions).toEqual({ cols: 500, rows: 200 });
	});

	it("falls back to 24-bit color on invalid depth", () => {
		const caps = new RioCapabilities();
		caps.detect({
			gpuAcceleration: false,
			colorDepth: 12,
			maxDimensions: { cols: 80, rows: 24 },
		} as never);
		expect(caps.get().colorDepth).toBe(24);
	});

	it("returns defensive copies from get()", () => {
		const caps = new RioCapabilities();
		caps.detect({
			gpuAcceleration: false,
			colorDepth: 24,
			maxDimensions: { cols: 80, rows: 24 },
		} as never);
		const a = caps.get();
		a.maxDimensions.cols = 1;
		a.inputModes.push("mutated");
		expect(caps.get().maxDimensions.cols).toBe(80);
		expect(caps.get().inputModes).toEqual(["raw", "cooked", "application"]);
	});
});
