import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { solidPlugin } from "esbuild-plugin-solid";

afterEach(() => {
	document.body.replaceChildren();
});

describe("desktop tab surfaces entrypoint (FR-TAB-001)", () => {
	test("mounted App provides every required tab surface", async () => {
		const root = document.createElement("div");
		root.id = "root";
		document.body.append(root);

		const build = await Bun.build({
			entrypoints: [join(import.meta.dir, "../../src/client.tsx")],
			target: "browser",
			format: "esm",
			plugins: [solidPlugin() as unknown as Bun.BunPlugin],
			define: { "process.env.NODE_ENV": JSON.stringify("test") },
		});
		expect(build.success, build.logs.map((log) => log.message).join("\n")).toBe(true);
		const bundle = await build.outputs[0]?.text();
		expect(bundle).toBeDefined();
		await import(`data:text/javascript;base64,${Buffer.from(bundle ?? "").toString("base64")}`);

		const expectedTabs = ["terminal", "agent", "session", "chat", "project"];
		const tabList = root.querySelector('[role="tablist"]');
		expect(tabList).not.toBeNull();

		for (const tab of expectedTabs) {
			const trigger = root.querySelector(`[role="tab"][data-tab-id="${tab}-tab"]`);
			const panel = root.querySelector(`[role="tabpanel"][data-tab-surface="${tab}"]`);
			expect(trigger, `${tab} tab trigger`).not.toBeNull();
			expect(panel, `${tab} tab surface`).not.toBeNull();
		}

		expect(root.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
		expect(root.querySelectorAll('[role="tabpanel"]')).toHaveLength(expectedTabs.length);
	});
});
