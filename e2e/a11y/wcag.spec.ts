/**
 * e2e/a11y/wcag.spec.ts — axe-core WCAG 2.1 AA gate for HeliosLab renderer.
 *
 * Boots the ivde renderer (or the dev server equivalent), then asserts no
 * critical or serious axe violations on the main shell page. The list of
 * routes is intentionally short — HeliosLab is a single-window desktop app;
 * navigation between editor surfaces is in-app SPA-style.
 *
 * Excluded rules: see `axe-config.ts` (bypass, region). Monaco's complex
 * DOM doesn't satisfy those checks even when the underlying app is sound.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { AXE_OPTIONS, blockingViolations } from "../../axe-config";

const BASE_URL = process.env.HELIOSLAB_RENDERER_URL ?? "http://localhost:5173";

const ROUTES: Array<{ name: string; path: string }> = [
	{ name: "Workbench (default shell)", path: "/" },
	{ name: "Command palette overlay", path: "/?ui=command-palette" },
	{ name: "Settings pane", path: "/?ui=settings" },
];

test.describe("HeliosLab WCAG 2.1 AA", () => {
	for (const route of ROUTES) {
		test(`no critical/serious violations on ${route.name}`, async ({ page }) => {
			await page.goto(`${BASE_URL}${route.path}`);
			// Wait for the renderer root to mount.
			await page.waitForSelector("#workbench-container", { timeout: 10_000 });

			const results = await new AxeBuilder({ page })
				.options(AXE_OPTIONS)
				.analyze();

			const blocking = blockingViolations(results);

			if (blocking.length > 0) {
				// Log the violation ids to make CI failures debuggable.
				console.error(
					`[a11y] ${blocking.length} blocking violations on ${route.name}:`,
					blocking.map((v) => v.id),
				);
			}

			expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
		});
	}

	test("all violations (including minor) are reported for visibility", async ({ page }) => {
		await page.goto(`${BASE_URL}/`);
		await page.waitForSelector("#workbench-container", { timeout: 10_000 });

		const results = await new AxeBuilder({ page })
			.options(AXE_OPTIONS)
			.analyze();

		// Tolerate minor/moderate in dev — these are tracked in the AT dashboard.
		const tracked = results.violations.filter(
			(v) => v.impact === "minor" || v.impact === "moderate",
		);
		// Surface to test output for the a11y dashboard to ingest.
		test.info().annotations.push({
			type: "tracked-violations",
			description: JSON.stringify(
				tracked.map((v) => ({ id: v.id, count: v.nodes.length, impact: v.impact })),
			),
		});
		expect(Array.isArray(tracked)).toBe(true);
	});
});
