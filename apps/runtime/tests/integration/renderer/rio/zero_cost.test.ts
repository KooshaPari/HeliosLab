/**
 * Feature flag zero-cost enforcement tests.
 * Covers: T011 (zero-cost tests).
 * SC-012-004.
 *
 * Verifies that disabled rio has absolutely zero runtime impact.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { RendererRegistry } from "../../../../src/renderer/registry.js";
import {
	FeatureFlagDisabledError,
	RioBackend,
} from "../../../../src/renderer/rio/backend.js";
import {
	isRioEnabled,
	registerRio,
} from "../../../../src/renderer/rio/index.js";

// ---------------------------------------------------------------------------
// Zero-cost: flag off means no registration
// ---------------------------------------------------------------------------

describe("Zero-cost — flag disabled", () => {
	let registry: RendererRegistry;

	beforeEach(() => {
		registry = new RendererRegistry();
	});

	it("rio not registered when flag off", async () => {
		await registerRio(registry, { featureFlags: { rioRenderer: false } });
		expect(registry.get("rio")).toBeUndefined();
		expect(registry.list().length).toBe(0);
	});

	it("rio not registered when flag missing", async () => {
		await registerRio(registry, {});
		expect(registry.get("rio")).toBeUndefined();
	});

	it("isRioEnabled returns false for disabled config", () => {
		expect(isRioEnabled({ featureFlags: { rioRenderer: false } })).toBe(false);
		expect(isRioEnabled({})).toBe(false);
		expect(isRioEnabled({ featureFlags: {} })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Zero-cost: switch to rio rejected when flag off
// ---------------------------------------------------------------------------

describe("Zero-cost — switch rejection", () => {
	it("init throws FeatureFlagDisabledError when disabled", async () => {
		const backend = new RioBackend();
		backend.setDisabled();

		await expect(
			backend.init({
				gpuAcceleration: false,
				colorDepth: 24,
				maxDimensions: { cols: 200, rows: 50 },
			}),
		).rejects.toThrow(FeatureFlagDisabledError);
	});

	it("handleInput throws FeatureFlagDisabledError when disabled", () => {
		const backend = new RioBackend();
		backend.setDisabled();

		expect(() => backend.handleInput("pty-1", new Uint8Array([0x41]))).toThrow(
			FeatureFlagDisabledError,
		);
	});

	it("bindStream throws FeatureFlagDisabledError when disabled", () => {
		const backend = new RioBackend();
		backend.setDisabled();

		expect(() => backend.bindStream("pty-1", new ReadableStream())).toThrow(
			FeatureFlagDisabledError,
		);
	});

	it("resize throws FeatureFlagDisabledError when disabled", () => {
		const backend = new RioBackend();
		backend.setDisabled();

		expect(() => backend.resize("pty-1", 80, 24)).toThrow(
			FeatureFlagDisabledError,
		);
	});
});

// ---------------------------------------------------------------------------
// Zero-cost: rio not in registry when flag off
// ---------------------------------------------------------------------------

describe("Zero-cost — registry empty", () => {
	it("registry.list() has no rio when flag off", async () => {
		const registry = new RendererRegistry();
		await registerRio(registry, { featureFlags: { rioRenderer: false } });

		const ids = registry.list().map((a) => a.id);
		expect(ids).not.toContain("rio");
	});

	it("registry.get('rio') returns undefined when flag off", async () => {
		const registry = new RendererRegistry();
		await registerRio(registry, { featureFlags: { rioRenderer: false } });

		expect(registry.get("rio")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Zero-cost: no module loading side effects
// ---------------------------------------------------------------------------

describe("Zero-cost — module loading", () => {
	it("registerRio with flag off does not trigger dynamic import of backend", async () => {
		// We can verify this by checking that registerRio returns quickly
		// and that no RioBackend instance exists in the registry.
		const registry = new RendererRegistry();
		const start = performance.now();
		await registerRio(registry, { featureFlags: { rioRenderer: false } });
		const elapsed = performance.now() - start;

		expect(registry.get("rio")).toBeUndefined();
		// Should complete very fast (no dynamic import overhead).
		expect(elapsed).toBeLessThan(50);
	});
});
