import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.join(__dirname, "..");

export default defineConfig({
	testDir: "./e2e",
	use: {
		baseURL: process.env.BASE_URL || "http://127.0.0.1:5173",
		trace: "on-first-retry",
	},
	webServer: {
		command: "npm run docs:dev",
		cwd: docsRoot,
		url: "http://127.0.0.1:5173/",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
