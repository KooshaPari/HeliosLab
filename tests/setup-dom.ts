/**
 * tests/setup-dom.ts — preload script for `bun test`. Registers happy-dom
 * globals (`document`, `window`, etc.) so unit tests that exercise DOM-touching
 * helpers (locale, dir) can run under the Node-style test runner instead of
 * needing a full browser.
 */
import { Window } from "happy-dom";

const window = new Window();
const g = globalThis as unknown as Record<string, unknown>;
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"navigator",
]) {
	const value = (window as unknown as Record<string, unknown>)[key];
	if (value !== undefined) g[key] = value;
}
