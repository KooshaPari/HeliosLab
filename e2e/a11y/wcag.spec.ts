// wcag.spec.ts
// e2e axe-core WCAG 2.1 AA gate for heliosApp.
//
// Boots each app's dev server (via playwright.config.ts webServer array) and
// runs AxeBuilder against the route map. Any critical/serious violation fails
// the spec. Warnings are surfaced in the report but do not fail.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config.js";
import { AXE_TAGS, type AxeAppKey, disabledRulesFor } from "./axe-config.js";

interface AppRoute {
  app: AxeAppKey;
  name: string;
  url: string;
}

const APP_ORIGINS: Record<AxeAppKey, string> = {
  "apps/desktop": `http://localhost:${PORTS.desktop}`,
  "apps/runtime": `http://localhost:${PORTS.runtime}`,
  "apps/colab-renderer": `http://localhost:${PORTS.colab}`,
};

const ROUTES: readonly AppRoute[] = [
  { app: "apps/desktop", name: "desktop-home", url: "/" },
  { app: "apps/desktop", name: "desktop-settings", url: "/settings" },
  { app: "apps/runtime", name: "runtime-home", url: "/" },
  { app: "apps/runtime", name: "runtime-status", url: "/status" },
  { app: "apps/colab-renderer", name: "colab-home", url: "/" },
].map(route => ({
  ...route,
  url: `${APP_ORIGINS[route.app]}${route.url}`,
}));

for (const route of ROUTES) {
  test(`a11y [${route.app}] ${route.name} meets WCAG 2.1 AA`, async ({ page }, testInfo) => {
    await page.goto(route.url, { waitUntil: "networkidle" });

    const builder = new AxeBuilder({ page })
      .withTags([...AXE_TAGS])
      .disableRules([...disabledRulesFor(route.app)]);

    const results = await builder.analyze();

    const failing = results.violations.filter(
      v => v.impact === "critical" || v.impact === "serious"
    );

    if (failing.length > 0) {
      const summary = failing
        .map(v => `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
        .join("\n");
      await testInfo.attach(`axe-${route.name}.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
      });
      throw new Error(`WCAG 2.1 AA violations on ${route.app}:${route.name}\n${summary}`);
    }

    expect(failing).toEqual([]);
  });
}
