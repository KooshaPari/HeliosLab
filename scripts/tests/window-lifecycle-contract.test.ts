import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createWindowLifecycleReport,
	evaluateWindowLifecycleContract,
} from "../window-lifecycle-contract";

const repositoryRoot = join(import.meta.dir, "..", "..");
const entryPath = join(repositoryRoot, "apps", "desktop", "src", "index.ts");
const persistencePath = join(
	repositoryRoot,
	"apps",
	"desktop",
	"src",
	"stores",
	"persistence.store.ts",
);

describe("window lifecycle contract (FR-SHL-005)", () => {
	test("current desktop exposes every missing lifecycle boundary", () => {
		const evidence = {
			entrySource: readFileSync(entryPath, "utf8"),
			persistenceSource: readFileSync(persistencePath, "utf8"),
		};
		const findings = evaluateWindowLifecycleContract(evidence);

		expect(findings.map((finding) => finding.rule)).toEqual([
			"window-create",
			"window-controls",
			"window-state-persistence",
		]);
		expect(findings.every((finding) => finding.remediation)).toBe(true);
	});

	test("repository contract remains a structured proper red", () => {
		const report = createWindowLifecycleReport({
			entrySource: readFileSync(entryPath, "utf8"),
			persistenceSource: readFileSync(persistencePath, "utf8"),
		});

		expect(report.status).toBe("fail");
		expect(report.findings).toHaveLength(3);
	});

	test("native controls and persisted geometry satisfy the contract", () => {
		const evidence = {
			entrySource: `
const window = createWindow();
window.close();
window.minimize();
window.maximize();
`,
			persistenceSource: `
const windowGeometry = loadWindowState();
persistWindowState(windowGeometry);
restoreWindowState(windowGeometry);
`,
		};

		expect(evaluateWindowLifecycleContract(evidence)).toEqual([]);
	});
});
