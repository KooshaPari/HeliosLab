// skip-link.spec.ts
// Verifies the skip-link is the first focusable element on every route.
// Tab from a blank page should focus the skip-link before any nav link.

import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/settings", "/status"] as const;

for (const route of ROUTES) {
  test(`skip-link is the first focusable element at ${route}`, async ({
    page,
  }) => {
    await page.goto(route);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () =>
        document.activeElement instanceof HTMLAnchorElement
          ? {
              tag: document.activeElement.tagName,
              text: document.activeElement.textContent,
              href: document.activeElement.getAttribute("href"),
              className: document.activeElement.className,
            }
          : null,
    );
    expect(focused).not.toBeNull();
    expect(focused?.tag).toBe("A");
    expect(focused?.className).toContain("skip-link");
    expect(focused?.href).toBe("#main");
    expect(focused?.text?.toLowerCase()).toContain("skip");
  });
}
