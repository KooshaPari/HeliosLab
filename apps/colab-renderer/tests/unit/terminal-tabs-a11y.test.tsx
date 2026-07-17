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

		const tab = root.querySelector('[role="tab"]');
		expect(tab).not.toBeNull();
		expect(tab?.parentElement?.getAttribute("role")).toBe("tablist");
	});
});
