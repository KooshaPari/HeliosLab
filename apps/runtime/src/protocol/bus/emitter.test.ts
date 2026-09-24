import { describe, expect, it } from "vitest";
import { InMemoryLocalBus } from "./emitter.js";
import type { EventEnvelope } from "./types.js";

type DeliveredEvent = EventEnvelope & { id?: string; ts?: string };

// Traces to: F5 — public `recovery.crash.detected` bus topic.
//
// The recovery-layer contract test
// (`apps/runtime/src/recovery/__tests__/recovery-bus-topic.test.ts`) covers the
// end-to-end crash-detection path. This file pins the bus-level dispatch
// contract that makes the topic observable in the first place, so the two
// cannot drift apart silently.

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "evt-1",
		type: "event" as const,
		ts: "2026-01-01T00:00:00.000Z",
		topic: "some.topic",
		payload: { hello: "world" },
		...overrides,
	};
}

describe("InMemoryLocalBus subscriber dispatch", () => {
	it("delivers a detached envelope preserving id and ts", async () => {
		const bus = new InMemoryLocalBus();
		const received: DeliveredEvent[] = [];
		bus.subscribe("some.topic", (evt) => received.push(evt));

		await bus.publish(makeEvent());

		expect(received).toHaveLength(1);
		expect(received[0].id).toBe("evt-1");
		expect(received[0].ts).toBe("2026-01-01T00:00:00.000Z");
		expect(received[0].topic).toBe("some.topic");
		expect(received[0].sequence).toBe(1);
		bus.destroy();
	});

	it("does not alias the logged envelope, so a consumer cannot mutate the audit trail", async () => {
		const bus = new InMemoryLocalBus();
		let received: DeliveredEvent | undefined;
		bus.subscribe("copy.topic", (evt) => {
			received = evt;
		});

		await bus.publish(makeEvent({ topic: "copy.topic" }));
		received!.payload!.hello = "mutated";
		received!.topic = "rewritten";

		const logged = bus.getEvents()[0];
		expect(logged.payload?.hello).toBe("world");
		expect(logged.topic).toBe("copy.topic");
		bus.destroy();
	});

	it("dispatches accepted lifecycle start topics before returning", async () => {
		const bus = new InMemoryLocalBus();
		const received: DeliveredEvent[] = [];
		bus.subscribe("lane.create.started", (evt) => received.push(evt));

		await bus.publish(
			makeEvent({
				topic: "lane.create.started",
				correlation_id: "c1",
				workspace_id: "ws-1",
				lane_id: "lane-1",
			}),
		);

		// Start topics take an early-return branch in publish(); before the fix
		// this delivery never happened and consumers silently missed operation
		// starts while still receiving the matching terminal events.
		expect(received).toHaveLength(1);
		expect(received[0].topic).toBe("lane.create.started");
		bus.destroy();
	});

	it("does not await promise-returning handlers, so a hanging subscriber cannot stall publish", async () => {
		const bus = new InMemoryLocalBus();
		let release!: () => void;
		const never = new Promise<void>((resolve) => {
			release = resolve;
		});
		let invoked = false;
		bus.subscribe("stall.topic", async () => {
			invoked = true;
			await never;
		});

		// publish() must settle even though the handler's promise never does.
		await bus.publish(makeEvent({ topic: "stall.topic" }));

		expect(invoked).toBe(true);
		release();
		bus.destroy();
	});

	it("isolates rejected subscriber promises without failing publish", async () => {
		const bus = new InMemoryLocalBus();
		const second: EventEnvelope[] = [];
		bus.subscribe("reject.topic", async () => {
			throw new Error("async subscriber blew up on purpose");
		});
		bus.subscribe("reject.topic", (evt) => second.push(evt));

		await expect(
			bus.publish(makeEvent({ topic: "reject.topic" })),
		).resolves.toBeUndefined();
		// Let the detached rejection sink observe the failure.
		await Promise.resolve();
		expect(second).toHaveLength(1);
		bus.destroy();
	});

	it("routes events to '*' all-topics subscribers alongside exact-topic subscribers", async () => {
		const bus = new InMemoryLocalBus();
		const all: EventEnvelope[] = [];
		const exact: EventEnvelope[] = [];
		bus.subscribe("*", (evt) => all.push(evt));
		bus.subscribe("wild.topic", (evt) => exact.push(evt));

		await bus.publish(makeEvent({ topic: "wild.topic" }));
		await bus.publish(makeEvent({ topic: "other.topic" }));

		expect(all.map((e) => e.topic)).toEqual(["wild.topic", "other.topic"]);
		expect(exact).toHaveLength(1);
		bus.destroy();
	});

	it("keeps delivery stable when a handler unsubscribes during dispatch", async () => {
		const bus = new InMemoryLocalBus();
		const order: string[] = [];
		const offSecond = bus.subscribe("reentrant.topic", () => {
			order.push("first");
			offSecond();
		});
		bus.subscribe("reentrant.topic", () => order.push("second"));

		await bus.publish(makeEvent({ topic: "reentrant.topic" }));

		// The snapshot is taken before iteration, so removing the second
		// handler cannot silently drop it from the in-flight dispatch.
		expect(order).toEqual(["first", "second"]);
		bus.destroy();
	});

	it("stops delivering after unsubscribe and after destroy", async () => {
		const bus = new InMemoryLocalBus();
		const received: DeliveredEvent[] = [];
		const off = bus.subscribe("off.topic", (evt) => received.push(evt));

		await bus.publish(makeEvent({ topic: "off.topic", id: "a" }));
		off();
		await bus.publish(makeEvent({ topic: "off.topic", id: "b" }));
		expect(received.map((e) => e.id)).toEqual(["a"]);

		// A still-registered subscriber must be dropped by destroy(), so the
		// third publish delivers nothing. Without this the test would pass even
		// if destroy() left the registry intact, because off() had already
		// emptied it.
		bus.subscribe("off.topic", (evt) => received.push(evt));
		bus.destroy();
		await bus.publish(makeEvent({ topic: "off.topic", id: "c" }));

		expect(received.map((e) => e.id)).toEqual(["a"]);
	});

	it("records every accepted event in the audit and event logs regardless of subscribers", async () => {
		const bus = new InMemoryLocalBus();
		await bus.publish(makeEvent({ topic: "logged.topic" }));

		expect(bus.getEvents()).toHaveLength(1);
		const records = await bus.getAuditRecords();
		expect(records).toHaveLength(1);
		expect(records[0].outcome).toBe("accepted");
		bus.destroy();
	});
});
