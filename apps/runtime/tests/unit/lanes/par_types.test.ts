import { describe, expect, it } from "bun:test";
import {
	ExecTimeoutError,
	generateParTaskId,
	isProcessAlive,
	LaneNotReadyError,
} from "../../../src/lanes/par-types";

describe("LaneNotReadyError", () => {
	it("names lane and state", () => {
		const e = new LaneNotReadyError("lane-7", "draining");
		expect(e.name).toBe("LaneNotReadyError");
		expect(e.laneId).toBe("lane-7");
		expect(e.state).toBe("draining");
		expect(e.message).toContain("lane-7");
		expect(e.message).toContain("draining");
	});
});

describe("ExecTimeoutError", () => {
	it("names lane and timeout", () => {
		const e = new ExecTimeoutError("lane-7", 2500);
		expect(e.name).toBe("ExecTimeoutError");
		expect(e.laneId).toBe("lane-7");
		expect(e.timeoutMs).toBe(2500);
		expect(e.message).toContain("2500ms");
	});
});

describe("generateParTaskId", () => {
	it("produces unique par-prefixed ids", () => {
		const a = generateParTaskId();
		const b = generateParTaskId();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^par_\d+/);
	});
});

describe("isProcessAlive", () => {
	it("returns true for the current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("returns false for a pid that cannot exist", () => {
		expect(isProcessAlive(999_999_999)).toBe(false);
	});
});
