import { describe, expect, it } from "bun:test";
import { METHODS, MethodRegistry } from "../../../src/protocol/methods";
import type { ResponseEnvelope } from "../../../src/protocol/types";

function ok(): ResponseEnvelope {
	return { type: "response", id: "1", ok: true, result: {} } as never;
}

describe("METHODS registry constants", () => {
	it("exposes the expected method set", () => {
		expect(METHODS).toContain("session.create");
		expect(METHODS).toContain("terminal.input");
		expect(METHODS).toContain("lane.cleanup");
		expect(METHODS.length).toBeGreaterThan(20);
	});
});

describe("MethodRegistry", () => {
	it("registers, resolves, and unregisters", () => {
		const registry = new MethodRegistry();
		const handler = () => ok();
		registry.register("session.create", handler);
		expect(registry.resolve("session.create")).toBe(handler);
		expect(registry.methods()).toEqual(["session.create"]);
		expect(registry.unregister("session.create")).toBe(true);
		expect(registry.resolve("session.create")).toBeUndefined();
		expect(registry.unregister("session.create")).toBe(false);
	});

	it("rejects duplicate registration", () => {
		const registry = new MethodRegistry();
		registry.register("lane.create", () => ok());
		expect(() => registry.register("lane.create", () => ok())).toThrow(
			/already registered/,
		);
	});

	it("rejects malformed method names", () => {
		const registry = new MethodRegistry();
		for (const bad of [
			"",
			"has space",
			"two..dots",
			".lead",
			"trail-",
			"ünicode",
		]) {
			expect(() => registry.register(bad, () => ok())).toThrow(
				/Invalid method name/,
			);
		}
	});

	it("lists methods in registration order", () => {
		const registry = new MethodRegistry();
		registry.register("a.b", () => ok());
		registry.register("c.d", () => ok());
		expect(registry.methods()).toEqual(["a.b", "c.d"]);
	});

	it("clear removes all handlers", () => {
		const registry = new MethodRegistry();
		registry.register("a.b", () => ok());
		registry.register("c.d", () => ok());
		registry.clear();
		expect(registry.methods()).toEqual([]);
		expect(registry.resolve("a.b")).toBeUndefined();
	});
});
