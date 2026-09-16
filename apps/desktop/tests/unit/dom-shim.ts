/**
 * DOM environment shim for Bun test runner using happy-dom.
 * Provides browser globals that desktop panel code references.
 */
import { Window } from "happy-dom";

const window = new Window();

// Install error constructors onto happy-dom window (required for internal querySelector)
for (const name of [
	"Error",
	"SyntaxError",
	"TypeError",
	"ReferenceError",
	"RangeError",
]) {
	const ctor = (globalThis as Record<string, unknown>)[name];
	if (ctor && typeof ctor === "function") {
		Object.defineProperty(window, name, {
			value: ctor,
			writable: true,
			configurable: true,
		});
	}
}

// Install browser globals onto globalThis
const globals = [
	"document",
	"HTMLElement",
	"customElements",
	"navigator",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"MutationObserver",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"Node",
	"NodeList",
	"Element",
	"HTMLDivElement",
	"HTMLSpanElement",
	"HTMLButtonElement",
	"HTMLInputElement",
	"getComputedStyle",
	"DOMException",
	"DocumentFragment",
	"Text",
	"Comment",
] as const;

for (const key of globals) {
	if (key in window && !(key in globalThis)) {
		Object.defineProperty(globalThis, key, {
			value: (window as unknown as Record<string, unknown>)[key],
			writable: true,
			configurable: true,
		});
	}
}

if (typeof globalThis.window === "undefined") {
	(globalThis as Record<string, unknown>).window = globalThis;
}
