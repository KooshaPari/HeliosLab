/**
 * playwright.config.ts — HeliosLab a11y test runner.
 *
 * The HeliosLab desktop app is built on electrobun, which wraps CEF. The
 * desktop dev mode does not expose an HTTP server, so we serve a minimal
 * HTML fixture (tests/fixtures/workbench.html) that mimics the workbench's
 * a11y-relevant DOM structure. axe-core and the e2e specs then exercise
 * that structure end-to-end. The desktop CEF build is validated separately
 * by the quality-gate workflow; this suite focuses on the a11y contract.
 *
 * Locally, set HELIOSLAB_SKIP_SERVER=1 to use an already-running server.
 */
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PORT = Number(process.env.HELIOSLAB_RENDERER_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;
process.env.HELIOSLAB_RENDERER_URL = BASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "tests", "fixtures");

export default defineConfig({
	testDir: "./e2e",
	testMatch: /.*\.spec\.ts$/,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: BASE_URL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: process.env.HELIOSLAB_SKIP_SERVER
		? undefined
		: {
				command: `bun run scripts/serve-fixture.mjs --port ${PORT} --root "${FIXTURE_DIR}"`,
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
				stdout: "ignore",
				stderr: "pipe",
			},
});
