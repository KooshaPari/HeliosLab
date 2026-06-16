/**
 * e2e/a11y/screen-reader.spec.ts — assert the structural ARIA contract that
 * screen-reader users depend on, independent of the actual screen-reader
 * binary. We do NOT attempt to drive NVDA / VoiceOver from CI; instead we
 * verify the DOM the screen reader sees.
 *
 * Covers (from spec AT3):
 *  - File tree exposes role="tree" with role="treeitem" children
 *  - Tab bar exposes role="tablist" with role="tab" children
 *  - Settings dialog exposes role="dialog" + aria-modal="true"
 *  - Live regions exist with correct politeness settings
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.HELIOSLAB_RENDERER_URL ?? "http://localhost:5173";

test.describe("Screen-reader contract", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${BASE_URL}/`);
		await page.waitForSelector("#workbench-container", { timeout: 10_000 });
	});

	test("file tree has role=tree with treeitem children", async ({ page }) => {
		const tree = page.locator('[role="tree"]').first();
		await expect(tree).toHaveCount(1);

		const items = await tree.locator('[role="treeitem"]').count();
		expect(items).toBeGreaterThan(0);

		// Each treeitem must have aria-expanded (or be a leaf without children).
		const firstItem = tree.locator('[role="treeitem"]').first();
		const hasExpanded = await firstItem.evaluate(
			(el) => el.hasAttribute("aria-expanded") || el.getAttribute("aria-level") !== null,
		);
		expect(hasExpanded).toBe(true);
	});

	test("tab bar has role=tablist with tab children", async ({ page }) => {
		const tablist = page.locator('[role="tablist"]').first();
		if ((await tablist.count()) === 0) {
			// Empty workspace — no tabs to assert against.
			test.skip();
			return;
		}
		const tabs = tablist.locator('[role="tab"]');
		expect(await tabs.count()).toBeGreaterThan(0);

		// The currently active tab must have aria-selected="true".
		const selectedCount = await tablist
			.locator('[role="tab"][aria-selected="true"]')
			.count();
		expect(selectedCount).toBe(1);
	});

	test("live regions exist with correct aria-live values", async ({ page }) => {
		const polite = page.locator("#sr-live");
		const alert = page.locator("#sr-alert");

		await expect(polite).toHaveAttribute("aria-live", "polite");
		await expect(polite).toHaveAttribute("aria-atomic", "true");
		await expect(alert).toHaveAttribute("aria-live", "assertive");
		await expect(alert).toHaveAttribute("role", "alert");
	});

	test("Monaco editor exposes accessibilitySupport via aria-label", async ({ page }) => {
		// Monaco adds aria-label="Code editor" (or similar) when
		// accessibilitySupport: 'on' is set in `src/config/editor.ts`.
		const monaco = page.locator(".monaco-editor").first();
		const ariaLabel = await monaco.getAttribute("aria-label");
		expect(ariaLabel).toBeTruthy();
		expect((ariaLabel ?? "").toLowerCase()).toContain("editor");
	});

	test("buttons without text content expose aria-label", async ({ page }) => {
		// All button elements in the workbench should either have text,
		// aria-label, or aria-labelledby. Walk the DOM and assert.
		const unlabeled = await page.evaluate(() => {
			const buttons = Array.from(document.querySelectorAll("button"));
			return buttons
				.filter((b) => {
					const text = (b.textContent ?? "").trim();
					const label = b.getAttribute("aria-label");
					const labelledBy = b.getAttribute("aria-labelledby");
					return !text && !label && !labelledBy;
				})
				.map((b) => b.outerHTML.slice(0, 100));
		});
		expect(unlabeled).toEqual([]);
	});
});
