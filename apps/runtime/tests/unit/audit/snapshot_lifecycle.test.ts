import { describe, expect, it } from "bun:test";
import { SnapshotCapture } from "../../../src/audit/snapshot";

describe("SnapshotCapture lifecycle", () => {
	it("captures immediately on start and then on interval", async () => {
		const capture = new SnapshotCapture();
		const snaps: unknown[] = [];
		capture.start("sess-1", 10, (s) => snaps.push(s));
		expect(snaps.length).toBe(1);
		expect(snaps[0]).toMatchObject({
			sessionId: "sess-1",
			dimensions: { rows: 24, cols: 80 },
		});
		await Bun.sleep(35);
		capture.stop();
		expect(snaps.length).toBeGreaterThanOrEqual(3);
	});

	it("start is idempotent while running", () => {
		const capture = new SnapshotCapture();
		const snaps: unknown[] = [];
		capture.start("s", 50_000, (s) => snaps.push(s));
		capture.start("s", 50_000, (s) => snaps.push(s));
		expect(snaps.length).toBe(1);
		capture.stop();
	});

	it("stop clears the timer so nothing fires afterwards", async () => {
		const capture = new SnapshotCapture();
		const snaps: unknown[] = [];
		capture.start("s", 10, (s) => snaps.push(s));
		capture.stop();
		const count = snaps.length;
		await Bun.sleep(40);
		expect(snaps.length).toBe(count);
	});

	it("stop without start is a safe no-op", () => {
		const capture = new SnapshotCapture();
		expect(() => capture.stop()).not.toThrow();
	});

	it("captureNow builds a well-formed snapshot", () => {
		const capture = new SnapshotCapture();
		let received: unknown;
		capture.captureNow("sess-9", (s) => {
			received = s;
		});
		const snap = received as Record<string, unknown>;
		expect(String(snap.id)).toMatch(/^snap-/);
		expect(snap.sessionId).toBe("sess-9");
		expect(typeof snap.timestamp).toBe("string");
		expect(snap.terminalBuffer).toBe("");
		expect(snap.cursorPosition).toEqual({ row: 0, col: 0 });
		expect(snap.scrollbackPosition).toBe(0);
	});
});
