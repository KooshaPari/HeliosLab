import { describe, expect, it } from "bun:test";
import type { PtyWriteSink } from "../../../../src/renderer/rio/input";
import { RioInputRelay } from "../../../../src/renderer/rio/input";

function makeSink() {
	const writes: Array<{ ptyId: string; data: Uint8Array }> = [];
	const sink: PtyWriteSink = {
		writeInput(ptyId, data) {
			writes.push({ ptyId, data: new Uint8Array(data) });
		},
	};
	return { sink, writes };
}

const BYTES = new Uint8Array([104, 105]);

describe("RioInputRelay", () => {
	it("relays raw bytes to the explicit pty", () => {
		const { sink, writes } = makeSink();
		const relay = new RioInputRelay();
		relay.setSink(sink);
		relay.relay("pty-1", BYTES);
		expect(writes).toEqual([{ ptyId: "pty-1", data: BYTES }]);
	});

	it("falls back to the focused pty when relay id is empty", () => {
		const { sink, writes } = makeSink();
		const relay = new RioInputRelay();
		relay.setSink(sink);
		relay.setFocusedPty("pty-focus");
		relay.relay("", BYTES);
		expect(writes).toEqual([{ ptyId: "pty-focus", data: BYTES }]);
	});

	it("discards input when nothing is focused and warns", () => {
		const { sink, writes } = makeSink();
		const warnings: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			const relay = new RioInputRelay();
			relay.setSink(sink);
			relay.relay("", BYTES);
			expect(writes).toEqual([]);
			expect(warnings[0]?.[0]).toMatch(/no focused PTY/);
		} finally {
			console.warn = original;
		}
	});

	it("drops bytes silently when no sink is set", () => {
		const relay = new RioInputRelay();
		relay.setFocusedPty("pty-1");
		expect(() => relay.relay("pty-1", BYTES)).not.toThrow();
		expect(relay.getLatencySamples().length).toBe(1);
	});

	it("tracks latency samples and average", () => {
		const { sink } = makeSink();
		const relay = new RioInputRelay();
		relay.setSink(sink);
		expect(relay.getAverageLatencyMs()).toBe(0);
		for (let i = 0; i < 5; i += 1) relay.relay("pty-1", BYTES);
		const samples = relay.getLatencySamples();
		expect(samples.length).toBe(5);
		const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
		expect(relay.getAverageLatencyMs()).toBe(avg);
	});

	it("caps latency samples at 100", () => {
		const { sink } = makeSink();
		const relay = new RioInputRelay();
		relay.setSink(sink);
		for (let i = 0; i < 130; i += 1) relay.relay("pty-1", BYTES);
		expect(relay.getLatencySamples().length).toBe(100);
	});
});
