/**
 * playwright.config.ts — HeliosLab a11y test runner.
 *
 * The HeliosLab desktop app is built on electrobun, which wraps CEF. The
 * dev experience is identical to a Vite + Solid.js browser app, so we run
 * the renderer against `bun run dev` (Vite) and point Playwright at the
 * local dev server. The `webServer` block boots the server in CI; locally,
 * if you already have `bun run dev` running, set HELIOSLAB_SKIP_SERVER=1.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.HELIOSLAB_RENDERER_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;
process.env.HELIOSLAB_RENDERER_URL = BASE_URL;

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
				command: "bun run dev --port " + PORT,
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
				stdout: "ignore",
				stderr: "pipe",
			},
});
