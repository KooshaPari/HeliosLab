import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { DepsRegistry } from "../deps-types";

const REGISTRY_PATH = join(process.cwd(), "deps-registry.json");

// Traces to: FR-DEP-001 (registry manifest), FR-DEP-003 (deterministic lockfile pins)
describe("Dependency Manifest", () => {
	test("valid manifest parses without errors", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		expect(registry).toBeDefined();
		expect(registry.schemaVersion).toBeDefined();
		expect(registry.metadata).toBeDefined();
		expect(registry.dependencies).toBeInstanceOf(Array);
	});

	test("manifest has required top-level fields", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		expect(registry.schemaVersion).toBe("1.0.0");
		expect(registry.metadata.lastStatusCheck).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(registry.metadata.registryCacheMaxAge).toBe("PT1H");
	});

	test("each dependency has all required fields", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		registry.dependencies.forEach((dep) => {
			expect(dep.name).toBeDefined();
			expect(typeof dep.name).toBe("string");

			expect(dep.currentPin).toBeDefined();
			expect(typeof dep.currentPin).toBe("string");

			expect(["alpha", "beta", "rc", "stable"]).toContain(dep.channel);

			expect(dep.upstreamSource).toBeDefined();
			expect(typeof dep.upstreamSource).toBe("string");

			expect(Array.isArray(dep.knownGoodHistory)).toBe(true);

			expect(dep.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});

	test("known-good history is ordered chronologically", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		registry.dependencies.forEach((dep) => {
			const timestamps = dep.knownGoodHistory.map((entry) =>
				new Date(entry.timestamp).getTime(),
			);

			for (let i = 1; i < timestamps.length; i++) {
				expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
			}
		});
	});

	test("each known-good entry has required fields", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		registry.dependencies.forEach((dep) => {
			dep.knownGoodHistory.forEach((entry) => {
				expect(entry.version).toBeDefined();
				expect(typeof entry.version).toBe("string");

				expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

				expect(["pass", "fail"]).toContain(entry.gateResult);
			});
		});
	});

	test("manifest contains expected dependencies", () => {
		const content = readFileSync(REGISTRY_PATH, "utf-8");
		const registry: DepsRegistry = JSON.parse(content);

		const depNames = registry.dependencies.map((d) => d.name);

		expect(depNames).toContain("electrobun");
		expect(depNames).toContain("ghostty");
		expect(depNames).toContain("zellij");
	});
});
