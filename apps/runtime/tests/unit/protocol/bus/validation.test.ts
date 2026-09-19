import { describe, expect, it } from "bun:test";
import {
	hasTopLevelDataField,
	isCommandEnvelope,
	isEventEnvelope,
} from "../../../../src/protocol/bus/validation";

describe("isCommandEnvelope", () => {
	it("accepts a valid command envelope", () => {
		expect(
			isCommandEnvelope({
				type: "command",
				method: "session.create",
				id: "cmd-1",
				payload: {},
			}),
		).toBe(true);
	});

	it("rejects non-objects and null", () => {
		expect(isCommandEnvelope(null)).toBe(false);
		expect(isCommandEnvelope(42)).toBe(false);
		expect(isCommandEnvelope("command")).toBe(false);
	});

	it("rejects wrong type discriminator", () => {
		expect(
			isCommandEnvelope({ type: "event", method: "m", id: "1", payload: {} }),
		).toBe(false);
	});

	it("rejects missing or non-string method / id", () => {
		expect(isCommandEnvelope({ type: "command", id: "1", payload: {} })).toBe(
			false,
		);
		expect(
			isCommandEnvelope({ type: "command", method: 7, id: "1", payload: {} }),
		).toBe(false);
		expect(
			isCommandEnvelope({ type: "command", method: "m", payload: {} }),
		).toBe(false);
		expect(
			isCommandEnvelope({ type: "command", method: "m", id: 1, payload: {} }),
		).toBe(false);
	});

	it("rejects missing payload", () => {
		expect(isCommandEnvelope({ type: "command", method: "m", id: "1" })).toBe(
			false,
		);
	});
});

describe("isEventEnvelope", () => {
	it("accepts a valid event envelope", () => {
		expect(isEventEnvelope({ type: "event", topic: "audit.recorded" })).toBe(
			true,
		);
	});

	it("rejects null and primitives", () => {
		expect(isEventEnvelope(null)).toBe(false);
		expect(isEventEnvelope(undefined)).toBe(false);
		expect(isEventEnvelope([])).toBe(false);
	});

	it("rejects wrong type or missing topic", () => {
		expect(isEventEnvelope({ type: "command", topic: "t" })).toBe(false);
		expect(isEventEnvelope({ type: "event" })).toBe(false);
		expect(isEventEnvelope({ type: "event", topic: 9 })).toBe(false);
	});
});

describe("hasTopLevelDataField", () => {
	it("detects own data property", () => {
		expect(hasTopLevelDataField({ data: 1 })).toBe(true);
		expect(hasTopLevelDataField({ data: undefined })).toBe(true);
	});

	it("rejects absent or inherited data", () => {
		expect(hasTopLevelDataField({})).toBe(false);
		const inherited = Object.create({ data: 1 }) as Record<string, unknown>;
		expect(hasTopLevelDataField(inherited)).toBe(false);
	});
});
