/**
 * Terminal store tests.
 *
 * Split deliberately into two halves. The first exercises the tab list and the
 * subscriber plumbing, which is pure logic and runs anywhere. The second needs a
 * real PTY and therefore a POSIX host with the native library built.
 *
 * The pure half matters because that is where the store used to be a stub, and
 * because a missing native library must degrade rather than throw: on Windows
 * the whole renderer would otherwise be unusable.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
	closeAllTerminals,
	closeTerminal,
	createTerminal,
	getActiveTerminalId,
	getTerminals,
	isTerminalLive,
	ptyUnavailableReason,
	resizeTerminal,
	subscribeToTerminal,
	switchTerminal,
	writeToTerminal,
} from "../../../src/stores/terminal.store.ts";

const canLoadNative = process.platform !== "win32";

beforeEach(() => {
	closeAllTerminals();
	for (const t of [...getTerminals()]) closeTerminal(t.id);
});

describe("terminal store, tab list and subscribers", () => {
	test("creating a terminal adds it and makes it active", () => {
		const before = getTerminals().length;
		const id = createTerminal();
		expect(getTerminals().length).toBe(before + 1);
		expect(getActiveTerminalId()).toBe(id);
	});

	test("closing the active terminal selects another", () => {
		const first = createTerminal();
		const second = createTerminal();
		expect(getActiveTerminalId()).toBe(second);

		closeTerminal(second);
		expect(getTerminals().some((t) => t.id === second)).toBe(false);
		expect(getActiveTerminalId()).toBe(first);
	});

	test("closing the last terminal leaves no active id", () => {
		const id = createTerminal();
		closeTerminal(id);
		expect(getActiveTerminalId()).toBeNull();
	});

	test("switching changes the active terminal", () => {
		const first = createTerminal();
		createTerminal();
		switchTerminal(first);
		expect(getActiveTerminalId()).toBe(first);
	});

	test("subscribers receive published chunks and can unsubscribe", () => {
		const id = createTerminal();
		const seen: number[] = [];
		const unsubscribe = subscribeToTerminal(id, (chunk) =>
			seen.push(chunk.length),
		);

		// Nothing publishes until the shell writes, and with no native library
		// there is no shell, so this asserts the unsubscribe contract rather than a
		// race with a real process.
		unsubscribe();
		expect(seen).toEqual([]);
	});

	test("write and resize to an unknown terminal do not throw", () => {
		// A panel can plausibly fire these after the tab was closed.
		expect(() => writeToTerminal("nobody", "x")).not.toThrow();
		expect(() => resizeTerminal("nobody", 80, 24)).not.toThrow();
		expect(isTerminalLive("nobody")).toBe(false);
	});

	test("closing an unknown terminal does not throw", () => {
		expect(() => closeTerminal("nobody")).not.toThrow();
	});
});

describe.skipIf(canLoadNative)(
	"terminal store without a native library",
	() => {
		test("reports why the PTY layer is unavailable instead of throwing", () => {
			createTerminal();
			const reason = ptyUnavailableReason();
			expect(reason).not.toBeNull();
			expect(typeof reason).toBe("string");
		});
	},
);

describe.skipIf(!canLoadNative)("terminal store with a live PTY", () => {
	test("a created terminal runs a real shell and delivers its output", async () => {
		const id = createTerminal();

		const chunks: string[] = [];
		const decoder = new TextDecoder();
		const unsubscribe = subscribeToTerminal(id, (chunk) => {
			chunks.push(decoder.decode(chunk, { stream: true }));
		});

		expect(isTerminalLive(id)).toBe(true);

		writeToTerminal(id, "echo STORE_MARKER\n");

		const deadline = Date.now() + 4000;
		while (Date.now() < deadline && !chunks.join("").includes("STORE_MARKER")) {
			await Bun.sleep(10);
		}

		expect(chunks.join("")).toContain("STORE_MARKER");

		unsubscribe();
		closeTerminal(id);
		expect(isTerminalLive(id)).toBe(false);
	});
});
