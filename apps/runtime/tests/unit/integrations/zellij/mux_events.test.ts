import { describe, expect, it } from "bun:test";
import {
	type EventBus,
	generateCorrelationId,
	type MuxEvent,
	MuxEventEmitter,
	MuxEventType,
} from "../../../../src/integrations/zellij/events";

function makeEvent(overrides: Partial<MuxEvent> = {}): MuxEvent {
	return {
		type: MuxEventType.SESSION_CREATED,
		sessionName: "work",
		laneId: "lane-1",
		timestamp: Date.now(),
		correlationId: "corr-1",
		...overrides,
	} as MuxEvent;
}

describe("generateCorrelationId", () => {
	it("produces unique incrementing ids", () => {
		const a = generateCorrelationId();
		const b = generateCorrelationId();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^mux-\d+-/);
	});
});

describe("MuxEventEmitter", () => {
	it("publishes to the bus", async () => {
		const published: MuxEvent[] = [];
		const bus: EventBus = {
			async publish(event) {
				published.push(event);
			},
		};
		const emitter = new MuxEventEmitter(bus);
		emitter.emit(makeEvent());
		await Bun.sleep(5);
		expect(published.length).toBe(1);
	});

	it("swallows bus failures instead of throwing", async () => {
		const warnings: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			const bus: EventBus = {
				publish() {
					return Promise.reject(new Error("bus down"));
				},
			};
			const emitter = new MuxEventEmitter(bus);
			expect(() => emitter.emit(makeEvent())).not.toThrow();
			await Bun.sleep(5);
			expect(warnings[0]?.[0]).toContain("[mux-events]");
			expect(String(warnings[0]?.[0])).toContain("bus down");
		} finally {
			console.warn = original;
		}
	});

	it("emitTyped fills timestamp and correlationId", () => {
		const published: MuxEvent[] = [];
		const bus: EventBus = {
			async publish(event) {
				published.push(event);
			},
		};
		const emitter = new MuxEventEmitter(bus);
		emitter.emitTyped({
			type: MuxEventType.PANE_ADDED,
			sessionName: "work",
			laneId: "lane-1",
			paneId: 2,
			dimensions: { cols: 80, rows: 24 },
		} as never);
		const event = published[0];
		expect(typeof event.timestamp).toBe("number");
		expect(event.timestamp).toBeGreaterThan(0);
		expect(event.correlationId).toMatch(/^mux-/);
	});

	it("emitTyped honors an explicit correlationId", () => {
		const published: MuxEvent[] = [];
		const bus: EventBus = {
			async publish(event) {
				published.push(event);
			},
		};
		const emitter = new MuxEventEmitter(bus);
		emitter.emitTyped({
			type: MuxEventType.TAB_CREATED,
			sessionName: "work",
			laneId: "lane-1",
			tabId: 1,
			tabName: "main",
			correlationId: "corr-fixed",
		} as never);
		expect(published[0].correlationId).toBe("corr-fixed");
	});
});
