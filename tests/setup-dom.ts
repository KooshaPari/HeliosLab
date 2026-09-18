/**
 * tests/setup-dom.ts — preload script for `bun test`. Registers happy-dom
 * globals (`document`, `window`, the event constructors, the element classes)
 * so unit tests that exercise DOM-touching code can run under Bun's test runner
 * instead of needing a real browser.
 *
 * This is the single source of truth for those globals. apps/desktop used to
 * carry a near-identical shim of its own and preload that from its own
 * bunfig.toml, which only took effect when tests were run from inside
 * apps/desktop. Runs from the repository root — which is what `bun run test`
 * and CI do — loaded this file instead, so the desktop panel tests got none of
 * the constructors they need and failed on `KeyboardEvent is not defined`. The
 * two lists are now one, so they cannot drift apart again.
 */
import { Window } from "happy-dom";

const window = new Window();
const win = window as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;

// happy-dom's own internals reach for the error constructors on the window, so
// point them at the real ones before anything queries the document.
for (const name of [
	"Error",
	"SyntaxError",
	"TypeError",
	"ReferenceError",
	"RangeError",
]) {
	if (typeof g[name] === "function") {
		Object.defineProperty(window, name, {
			value: g[name],
			writable: true,
			configurable: true,
		});
	}
}

// Browser globals the tests construct or call by their browser names. Each is
// only installed when Bun does not already provide it, so Bun's own Event,
// DOMException and friends stay in place and only the gaps get filled.
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"NodeList",
	"Text",
	"Comment",
	"DocumentFragment",
	"HTMLDivElement",
	"HTMLSpanElement",
	"HTMLButtonElement",
	"HTMLInputElement",
	"customElements",
	"navigator",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"DOMException",
	"MutationObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
]) {
	const value = win[key];
	if (value !== undefined && !(key in g)) {
		Object.defineProperty(g, key, {
			value,
			writable: true,
			configurable: true,
		});
	}
}
