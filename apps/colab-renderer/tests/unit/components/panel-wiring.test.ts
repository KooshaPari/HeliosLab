/**
 * Tests for the panel's wiring.
 *
 * These need no DOM and no JSX runtime, which is the point of extracting the
 * logic: the component itself cannot be rendered under Bun's transpiler in this
 * repo, but everything that decides where data goes can be tested directly.
 */
import { describe, expect, test } from "bun:test";
import {
	reportTerminalSize,
	type TerminalLike,
	type TerminalWiringDeps,
	wireTerminal,
} from "../../../src/components/terminal/panel-wiring.ts";

/** A stand-in for xterm's Terminal. */
function fakeTerminal(cols = 80, rows = 24) {
	const written: Uint8Array[] = [];
	let inputHandler: ((data: string) => void) | null = null;
	let inputDisposed = false;

	const terminal: TerminalLike = {
		cols,
		rows,
		write: (chunk) => {
			written.push(chunk);
		},
		onData: (handler) => {
			inputHandler = handler;
			return {
				dispose: () => {
					inputDisposed = true;
				},
			};
		},
	};

	return {
		terminal,
		written,
		emitInput: (data: string) => inputHandler?.(data),
		get inputDisposed() {
			return inputDisposed;
		},
	};
}

/** A stand-in for the store functions. */
function fakeDeps() {
	const subscribed: string[] = [];
	const unsubscribed: string[] = [];
	const writes: Array<{ id: string; data: string }> = [];
	const resizes: Array<{ id: string; cols: number; rows: number }> = [];
	let publish: ((chunk: Uint8Array) => void) | null = null;

	const deps: TerminalWiringDeps = {
		subscribeToTerminal: (terminalId, listener) => {
			subscribed.push(terminalId);
			publish = listener;
			return () => {
				unsubscribed.push(terminalId);
			};
		},
		writeToTerminal: (terminalId, data) => {
			writes.push({ id: terminalId, data });
		},
		resizeTerminal: (terminalId, cols, rows) => {
			resizes.push({ id: terminalId, cols, rows });
		},
	};

	return {
		deps,
		subscribed,
		unsubscribed,
		writes,
		resizes,
		emitOutput: (chunk: Uint8Array) => publish?.(chunk),
	};
}

describe("wireTerminal", () => {
	test("subscribes to the given terminal", () => {
		const t = fakeTerminal();
		const d = fakeDeps();
		wireTerminal("term-a", t.terminal, d.deps);
		expect(d.subscribed).toEqual(["term-a"]);
	});

	test("routes shell output into xterm", () => {
		const t = fakeTerminal();
		const d = fakeDeps();
		wireTerminal("term-a", t.terminal, d.deps);

		const chunk = new TextEncoder().encode("from the shell");
		d.emitOutput(chunk);

		expect(t.written).toEqual([chunk]);
	});

	test("routes keystrokes to the shell", () => {
		const t = fakeTerminal();
		const d = fakeDeps();
		wireTerminal("term-b", t.terminal, d.deps);

		t.emitInput("l");
		t.emitInput("s");

		expect(d.writes).toEqual([
			{ id: "term-b", data: "l" },
			{ id: "term-b", data: "s" },
		]);
	});

	test("dispose unsubscribes and releases the input handler", () => {
		const t = fakeTerminal();
		const d = fakeDeps();
		const wiring = wireTerminal("term-c", t.terminal, d.deps);

		wiring.dispose();

		expect(d.unsubscribed).toEqual(["term-c"]);
		// Both directions matter. Leaving the input handler attached keeps a
		// disposed xterm instance alive and still able to reach the shell.
		expect(t.inputDisposed).toBe(true);
	});
});

describe("reportTerminalSize", () => {
	test("reports the terminal's current size", () => {
		const t = fakeTerminal(133, 47);
		const d = fakeDeps();

		reportTerminalSize("term-d", t.terminal, d.deps);

		expect(d.resizes).toEqual([{ id: "term-d", cols: 133, rows: 47 }]);
	});

	test("reports the size at call time, not a captured one", () => {
		// The panel resizes by mutating the terminal, so a helper that took cols and
		// rows as arguments could be handed values captured earlier and report a
		// size the terminal no longer has.
		const t = fakeTerminal(80, 24);
		const d = fakeDeps();

		// Simulate fit() changing the dimensions on the same object.
		(t.terminal as { cols: number }).cols = 100;
		(t.terminal as { rows: number }).rows = 30;

		reportTerminalSize("term-e", t.terminal, d.deps);

		expect(d.resizes).toEqual([{ id: "term-e", cols: 100, rows: 30 }]);
	});
});
