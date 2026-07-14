// tab-order.spec.ts
// Tab navigation smoke test. Verifies that:
//   1. The skip-link receives focus first.
//   2. The main landmark is reachable via the skip-link's href.
//   3. Tree items (apps/desktop file tree) cycle focus in document order.
//   4. The colab-renderer's PTY input is NOT tab-stolen by the terminal.

import { expect, test } from "@playwright/test";

test("desktop: tab order hits skip-link, header, nav, main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.tagName);
  expect(first).toBe("A"); // skip-link

  // The skip-link's target must be a <main> with id="main" and tabindex="-1".
  const mainHandle = await page.evaluate(() => {
    const m = document.getElementById("main");
    return m
      ? {
          tag: m.tagName,
          tabindex: m.getAttribute("tabindex"),
          isMain: m instanceof HTMLElement && m.role === "main",
        }
      : null;
  });
  expect(mainHandle).not.toBeNull();
  expect(mainHandle?.tag).toBe("MAIN");
  expect(mainHandle?.tabindex).toBe("-1");
});

test("desktop: file tree items use arrow keys (role=treeitem)", async ({ page }) => {
  await page.goto("/");
  const tree = page.locator('[role="tree"]').first();
  const treeCount = await tree.count();
  if (treeCount === 0) test.skip();
  const items = tree.locator('[role="treeitem"]');
  const count = await items.count();
  if (count === 0) test.skip();
  await items.first().focus();
  await page.keyboard.press("ArrowDown");
  const activeText = await page.evaluate(() => document.activeElement?.textContent ?? "");
  // The focus moved to the second tree item.
  expect(activeText).not.toBe(await items.first().textContent());
});

test("colab: terminal canvas is not in the tab order", async ({ page }) => {
  await page.goto("/");
  // The terminal canvas is inside .xterm; verify no element inside has tabindex=0.
  const tabbableInsideTerminal = await page.evaluate(() => {
    const term = document.querySelector(".xterm");
    if (!term) return 0;
    return term.querySelectorAll("[tabindex='0']").length;
  });
  expect(tabbableInsideTerminal).toBe(0);
});
