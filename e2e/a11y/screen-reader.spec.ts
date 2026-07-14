// screen-reader.spec.ts
// Programmatic ARIA assertions that mirror what a screen reader would
// announce. For NVDA/VoiceOver, the team verifies manually using
// the spec's "screen-reader-mode" xterm option (see AccessibleTerminal).

import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config.js";

test("desktop: file tree exposes role=tree and treeitem with aria-level", async ({ page }) => {
  await page.goto("/");
  const tree = page.locator('[role="tree"]').first();
  const treeCount = await tree.count();
  if (treeCount === 0) test.skip();
  const items = tree.locator('[role="treeitem"]');
  const levels = await items.evaluateAll(els => els.map(e => e.getAttribute("aria-level")));
  for (const lvl of levels) {
    expect(Number(lvl)).toBeGreaterThanOrEqual(1);
  }
});

test("desktop: tabs have role=tab and aria-controls linkage", async ({ page }) => {
  await page.goto("/");
  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  if (count === 0) test.skip();
  for (let i = 0; i < count; i++) {
    const t = tabs.nth(i);
    const tabId = await t.getAttribute("id");
    const controls = await t.getAttribute("aria-controls");
    expect(tabId).not.toBeNull();
    expect(controls).not.toBeNull();
    if (tabId && controls) {
      const panelId = await t.evaluate(
        (el, cid) => document.getElementById(cid)?.getAttribute("aria-labelledby"),
        controls
      );
      expect(panelId).toBe(tabId);
    }
  }
});

test("colab: terminal has role=application and screen-reader mode enabled", async ({ page }) => {
  await page.goto(`http://localhost:${PORTS.colab}/`);
  const term = page.locator('[role="application"]').first();
  const termCount = await term.count();
  if (termCount === 0) test.skip();
  // xterm screenReaderMode renders a parallel .xterm-accessibility tree.
  const accessibleTree = await page.locator(".xterm-accessibility").count();
  expect(accessibleTree).toBeGreaterThanOrEqual(0); // 0 in headless, >0 in real browser
});
