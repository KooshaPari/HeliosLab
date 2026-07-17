import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("a11y e2e dependency contract", () => {
	test("the root manifest declares the axe adapter imported by the hosted gate", () => {
		const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
			devDependencies?: Record<string, string>;
		};
		const spec = readFileSync(join(root, "e2e", "a11y", "wcag.spec.ts"), "utf8");

		expect(spec).toContain('from "@axe-core/playwright"');
		expect(manifest.devDependencies?.["@axe-core/playwright"]).toBeDefined();
	});
});
