// playwright.config.ts
// Playwright config for heliosApp monorepo — drives all 3 apps in one run.
// The webServer array boots each app's dev server on a unique port so the
// wcag.spec.ts route map can hit them in parallel.

import { defineConfig, devices } from "@playwright/test";

export const PORTS = {
  desktop: 5173,
  runtime: 5174,
  colab: 5175,
} as const;

const launchOptions = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
  : {};

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/a11y/**/*.spec.ts", "apps/desktop/tests/e2e/**/*.spec.ts"],
  // Root-level discovery must not recurse into nested clones or worktree collections.
  testIgnore: ["**/.scoped-migration-notice-pr/**", "**/*-wtrees/**", "**/*-worktrees/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORTS.desktop}`,
    headless: true,
    launchOptions,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `bun run --cwd apps/desktop dev --port ${PORTS.desktop}`,
      url: `http://localhost:${PORTS.desktop}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `bun run --cwd apps/runtime dev --port ${PORTS.runtime}`,
      url: `http://localhost:${PORTS.runtime}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `bun run --cwd apps/colab-renderer dev --port ${PORTS.colab}`,
      url: `http://localhost:${PORTS.colab}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
