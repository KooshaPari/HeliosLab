/**
 * e2e/a11y/skip-link.spec.ts — verify the skip-link is the first focusable
 * element on the workbench and activates the right target.
 *
 * Two skip-links exist per the AT2 spec:
 *  - "Skip to main content"  → #main
 *  - "Skip to file tree"     → #file-tree (left pane)
 *  - "Skip to editor"        → #editor-pane (center)
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.HELIOSLAB_RENDERER_URL ?? "http://localhost:5173";

test.describe("Skip links", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${BASE_URL}/`);
		await page.waitForSelector("#workbench-container", { timeout: 10_000 });
	});

	test("skip-to-main is the first focusable element", async ({ page }) => {
		// Focus the body so the first Tab moves into the skip-link.
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		await page.keyboard.press("Tab");

		const activeId = await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.id,
		);
		expect(activeId).toBe("skip-to-main");
	});

	test("skip-to-file-tree is the second focusable element", async ({ page }) => {
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");

		const activeId = await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.id,
		);
		expect(activeId).toBe("skip-to-file-tree");
	});

	test("skip-to-editor is the third focusable element", async ({ page }) => {
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");

		const activeId = await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.id,
		);
		expect(activeId).toBe("skip-to-editor");
	});

	test("activating skip-to-main moves focus to the <main> region", async ({ page }) => {
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		await page.keyboard.press("Tab");
		await page.keyboard.press("Enter");

		const focusedTagAndId = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			return { tag: el?.tagName, id: el?.id };
		});
		expect(focusedTagAndId.tag?.toLowerCase()).toBe("main");
		expect(focusedTagAndId.id).toBe("main");
	});
});
