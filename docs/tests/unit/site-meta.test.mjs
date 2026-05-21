import assert from "node:assert/strict";
import test from "node:test";
import { createSiteMeta } from "../../.vitepress/site-meta.mjs";

test("createSiteMeta is a function", () => {
	assert.strictEqual(typeof createSiteMeta, "function");
});
