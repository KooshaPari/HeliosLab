import { describe, expect, it } from "bun:test";
import { TOPICS, TopicRegistry } from "../../../src/protocol/topics";
import type { EventEnvelope } from "../../../src/protocol/types";

function evt(topic: string): EventEnvelope {
	return { type: "event", topic, payload: {} } as never;
}

describe("TOPICS constants", () => {
	it("exposes the expected topic set", () => {
		expect(TOPICS).toContain("session.created");
		expect(TOPICS).toContain("audit.recorded");
		expect(TOPICS).toContain("recovery.safemode.entered");
		expect(TOPICS.length).toBeGreaterThan(40);
	});
});

describe("TopicRegistry", () => {
	it("subscribe returns an idempotent unsubscribe", () => {
		const registry = new TopicRegistry();
		const calls: EventEnvelope[] = [];
		const unsub = registry.subscribe("audit.recorded", (e) => calls.push(e));
		unsub();
		unsub();
		expect(registry.subscribers("audit.recorded")).toEqual([]);
		expect(registry.topics()).toEqual([]);
	});

	it("supports multiple subscribers with ordered delivery", () => {
		const registry = new TopicRegistry();
		const order: string[] = [];
		registry.subscribe("terminal.output", () => order.push("first"));
		registry.subscribe("terminal.output", () => order.push("second"));
		for (const sub of registry.subscribers("terminal.output"))
			sub(evt("terminal.output"));
		expect(order).toEqual(["first", "second"]);
	});

	it("same function can subscribe twice and unsubscribe removes one entry", () => {
		const registry = new TopicRegistry();
		const fn = (): void => {};
		const unsub1 = registry.subscribe("lane.created", fn);
		registry.subscribe("lane.created", fn);
		expect(registry.subscribers("lane.created").length).toBe(2);
		unsub1();
		expect(registry.subscribers("lane.created").length).toBe(1);
	});

	it("subscribers returns a snapshot safe from mutation during iteration", () => {
		const registry = new TopicRegistry();
		registry.subscribe("session.created", () => {});
		const snapshot = registry.subscribers("session.created");
		registry.subscribe("session.created", () => {});
		expect(snapshot.length).toBe(1);
		expect(registry.subscribers("session.created").length).toBe(2);
	});

	it("rejects malformed topic names", () => {
		const registry = new TopicRegistry();
		for (const bad of ["", "has space", "a..b", ".lead", "ünicode"]) {
			expect(() => registry.subscribe(bad, () => {})).toThrow(
				/Invalid topic name/,
			);
		}
	});

	it("nextSequence increments and getSequence reads back", () => {
		const registry = new TopicRegistry();
		expect(registry.getSequence("agent.run.started")).toBe(0);
		expect(registry.nextSequence("agent.run.started")).toBe(1);
		expect(registry.nextSequence("agent.run.started")).toBe(2);
		expect(registry.getSequence("agent.run.started")).toBe(2);
	});

	it("sequences are per-topic", () => {
		const registry = new TopicRegistry();
		registry.nextSequence("t.one");
		registry.nextSequence("t.one");
		expect(registry.nextSequence("t.two")).toBe(1);
	});

	it("unsubscribing the last subscriber clears sequence state", () => {
		const registry = new TopicRegistry();
		const unsub = registry.subscribe("t.x", () => {});
		registry.nextSequence("t.x");
		unsub();
		expect(registry.topics()).toEqual([]);
	});

	it("clear removes all subscriptions and sequences", () => {
		const registry = new TopicRegistry();
		registry.subscribe("t.a", () => {});
		registry.subscribe("t.b", () => {});
		registry.nextSequence("t.a");
		registry.clear();
		expect(registry.topics()).toEqual([]);
		expect(registry.getSequence("t.a")).toBe(0);
	});
});
