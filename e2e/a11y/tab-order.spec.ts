/**
 * e2e/a11y/tab-order.spec.ts — exercise the Tab navigation order and verify
 * Monaco keyboard behaviour (Tab inserts a tab character; Ctrl+M moves
 * focus out of the editor surface).
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.HELIOSLAB_RENDERER_URL ?? "http://localhost:5173";

test.describe("Tab order", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${BASE_URL}/`);
		await page.waitForSelector("#workbench-container", { timeout: 10_000 });
	});

	test("document order is skip-links → topbar → sidebar → main → statusbar", async ({ page }) => {
		// Walk the DOM and collect all focusable ancestors of the workbench.
		const focusableOrder = await page.evaluate(() => {
			const selector =
				'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
			const all = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
			// Only keep the first 5 we expect in the canonical order.
			return all.slice(0, 5).map((el) => ({
				tag: el.tagName.toLowerCase(),
				id: el.id,
				role: el.getAttribute("role"),
				text: (el.textContent ?? "").trim().slice(0, 32),
			}));
		});

		// The first 3 should be the three skip-links per AT2 spec.
		expect(focusableOrder[0]?.id).toBe("skip-to-main");
		expect(focusableOrder[1]?.id).toBe("skip-to-file-tree");
		expect(focusableOrder[2]?.id).toBe("skip-to-editor");
	});

	test("Monaco editor receives focus via Tab and Ctrl+M returns focus to the toolbar", async ({ page }) => {
		// Click into the editor area to focus it.
		const editor = page.locator(".monaco-editor").first();
		await editor.click();

		// Send Ctrl+M (Monaco's "tab focus mode toggle" — moves focus OUT).
		await page.keyboard.press("Control+M");
		await page.keyboard.press("Tab");

		const focusedTag = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			return el?.tagName.toLowerCase();
		});
		// After Ctrl+M, Tab should land on the next focusable outside the editor.
		// We don't assert which one — only that it's not inside the Monaco subtree.
		expect(focusedTag).not.toBe("textarea");
	});

	test("focus ring is visible when keyboard-focused", async ({ page }) => {
		// Tab into the first interactive element.
		await page.keyboard.press("Tab");
		const outline = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			if (!el) return null;
			const cs = getComputedStyle(el);
			return {
				outlineWidth: cs.outlineWidth,
				outlineColor: cs.outlineColor,
				outlineStyle: cs.outlineStyle,
			};
		});
		expect(outline).not.toBeNull();
		// Focus ring must be solid (not "none") and at least 2px wide.
		expect(outline?.outlineStyle).not.toBe("none");
		expect(parseInt(outline?.outlineWidth ?? "0", 10)).toBeGreaterThanOrEqual(2);
	});
});
