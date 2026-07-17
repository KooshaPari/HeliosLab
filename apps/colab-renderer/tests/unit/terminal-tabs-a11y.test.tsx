import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { solidPlugin } from "esbuild-plugin-solid";

afterEach(() => {
	document.body.replaceChildren();
});

describe("colab terminal tabs accessibility", () => {
	test("every tab is owned by a tablist", async () => {
		const root = document.createElement("div");
		root.id = "root";
		document.body.append(root);

		const projectRoot = join(import.meta.dir, "../../../..");
		const outputDirectory = mkdtempSync(join(projectRoot, ".tmp-colab-a11y-"));
		const fixturePath = join(outputDirectory, "fixture.tsx");
		const componentPath = join(import.meta.dir, "../../src/components/terminal/TerminalTabs.tsx");
		const storePath = join(import.meta.dir, "../../src/stores/terminal.store.ts");
		writeFileSync(
			fixturePath,
			`import { render } from "solid-js/web";
import { TerminalTabs } from ${JSON.stringify(componentPath)};
import { createTerminal } from ${JSON.stringify(storePath)};
createTerminal();
createTerminal();
const root = document.getElementById("root");
if (root) render(() => <TerminalTabs />, root);
`,
		);

		const build = await Bun.build({
			entrypoints: [fixturePath],
			root: projectRoot,
			target: "browser",
			format: "esm",
			plugins: [solidPlugin() as unknown as Bun.BunPlugin],
			define: { "process.env.NODE_ENV": JSON.stringify("test") },
		});
		expect(build.success, build.logs.map((log) => log.message).join("\n")).toBe(true);
		const bundle = await build.outputs[0]?.text();
		expect(bundle).toBeDefined();
		const outputPath = join(outputDirectory, "bundle.mjs");
		writeFileSync(outputPath, bundle ?? "");
		try {
			await import(pathToFileURL(outputPath).href);
		} finally {
			rmSync(outputDirectory, { recursive: true, force: true });
		}

		const tablist = root.querySelector('[role="tablist"]');
		const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
		const tab = tabs[0];
		const closeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Close "]'));
		const addButton = root.querySelector('button[aria-label="New terminal"]');
		expect(tablist).not.toBeNull();
		expect(tabs).toHaveLength(2);
		expect(tab?.parentElement?.getAttribute("role")).toBe("tablist");
		expect(Array.from(tablist?.children ?? []).map((child) => child.getAttribute("role"))).toEqual([
			"tab",
			"tab",
		]);
		expect(tabs.every((item) => item.tagName === "BUTTON")).toBe(true);
		expect(tabs.every((item) => item.querySelector("button, a, input, select, textarea") === null)).toBe(
			true,
		);
		expect(closeButtons).toHaveLength(2);
		expect(closeButtons.every((button) => button.closest('[role="tab"]') === null)).toBe(true);
		expect(closeButtons.every((button) => button.closest('[role="tablist"]') === null)).toBe(true);
		expect(addButton).not.toBeNull();
		expect(addButton?.parentElement).toBe(tablist?.parentElement);
		expect(addButton?.parentElement).not.toBe(tablist);

		tab?.click();
		expect(tab?.getAttribute("aria-selected")).toBe("true");
		closeButtons[0]?.click();
		expect(root.querySelectorAll('[role="tab"]')).toHaveLength(1);
	});
});
