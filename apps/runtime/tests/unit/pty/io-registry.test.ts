/**
 * PTY I/O and registry surface coverage.
 *
 * Targets `pty/io.ts` and `pty/registry.ts`, both of which sit below the
 * runtime-coverage threshold and feed the vertical-slice driver. The tests
 * exercise every public path: writeInput success + invalid state + missing
 * handle + write-failure paths, and PtyRegistry register/get/list/lookup
 * + duplicate + capacity branches.
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { describe, expect, it } from "bun:test";
import { InMemoryLocalBus } from "../../../src/protocol/bus.js";
import type { LocalBus, LocalBusEnvelope } from "../../../src/protocol/bus.js";
import { InvalidStateError, writeInput } from "../../../src/pty/io.js";
import type { ProcessMap } from "../../../src/pty/io.js";
import {
	DuplicatePtyError,
	PtyRegistry,
	RegistryCapacityError,
} from "../../../src/pty/registry.js";
import type { PtyRecord } from "../../../src/pty/registry.js";

function makeRecord(state: PtyRecord["state"] = "active"): PtyRecord {
	return {
		ptyId: "pty-1",
		laneId: "lane-1",
		sessionId: "sess-1",
		terminalId: "term-1",
		pid: 4321,
		state,
		dimensions: { cols: 80, rows: 24 },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		env: {},
	};
}

describe("writeInput", () => {
	it("writes bytes to a live PTY and returns the count + latency", () => {
		const bus = new InMemoryLocalBus();
		const record = makeRecord("active");
		const processMap: ProcessMap = new Map([
			[
				record.ptyId,
				{ stdin: { write: () => 5 } },
			],
		]);

		const result = writeInput(record, new Uint8Array([1, 2, 3, 4, 5]), processMap, bus);
		expect(result.bytesWritten).toBe(5);
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("treats zero-length writes as a no-op", () => {
		const bus = new InMemoryLocalBus();
		const record = makeRecord("active");
		const processMap: ProcessMap = new Map([
			[
				record.ptyId,
				{ stdin: { write: () => -1 } },
			],
		]);

		const result = writeInput(record, new Uint8Array(0), processMap, bus);
		expect(result.bytesWritten).toBe(0);
	});

	it("throws InvalidStateError when the PTY is not in a writable state", () => {
		const bus = new InMemoryLocalBus();
		const record = makeRecord("error");
		const processMap: ProcessMap = new Map();

		expect(() =>
			writeInput(record, new Uint8Array([1]), processMap, bus),
		).toThrow(InvalidStateError);
	});

	it("throws when no process handle is registered for the PTY", () => {
		const bus = new InMemoryLocalBus();
		const record = makeRecord("throttled");
		const processMap: ProcessMap = new Map();

		expect(() =>
			writeInput(record, new Uint8Array([1]), processMap, bus),
		).toThrow(InvalidStateError);
	});

	it("publishes pty.error and invokes onError when the write fails", () => {
		class CapturingBus extends InMemoryLocalBus {
			published: LocalBusEnvelope[] = [];
			override async publish(envelope: LocalBusEnvelope): Promise<void> {
				this.published.push(envelope);
			}
		}
		const bus = new CapturingBus();
		const record = makeRecord("active");
		const failing = {
			stdin: {
				write: () => {
					throw new Error("broken pipe");
				},
			},
		};
		const processMap: ProcessMap = new Map([[record.ptyId, failing]]);

		let erroredPtyId: string | undefined;
		expect(() =>
			writeInput(
				record,
				new Uint8Array([1, 2]),
				processMap,
				bus as unknown as LocalBus,
				(id) => {
					erroredPtyId = id;
				},
			),
		).toThrow(/broken pipe/);

		expect(erroredPtyId).toBe(record.ptyId);
		const errorEvent = bus.published.find(
			(envelope) => envelope.topic === "pty.error",
		);
		expect(errorEvent).toBeDefined();
		expect(errorEvent?.payload).toMatchObject({ reason: "write_failed" });
	});
});

describe("PtyRegistry surface coverage", () => {
	const seed = (i: number, laneId = "lane-1", sessionId = "sess-1"): PtyRecord => ({
		ptyId: `pty-${i}`,
		laneId,
		sessionId,
		terminalId: `term-${i}`,
		pid: 1000 + i,
		state: "active",
		dimensions: { cols: 80, rows: 24 },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		env: {},
	});

	it("register()/get() round-trip and rejects duplicates", () => {
		const registry = new PtyRegistry();
		registry.register(seed(1));
		expect(registry.get("pty-1")?.laneId).toBe("lane-1");

		expect(() => registry.register(seed(1))).toThrow(DuplicatePtyError);
	});

	it("getByLane and getBySession return copies of matching records", () => {
		const registry = new PtyRegistry();
		registry.register(seed(1, "lane-A"));
		registry.register(seed(2, "lane-A", "sess-2"));
		registry.register(seed(3, "lane-B"));

		const lanes = registry.getByLane("lane-A");
		expect(lanes.map((r) => r.ptyId).sort()).toEqual(["pty-1", "pty-2"]);
		const sessions = registry.getBySession("sess-2");
		expect(sessions.map((r) => r.ptyId)).toEqual(["pty-2"]);
	});

	it("list() returns all registered records; count() reflects the size", () => {
		const registry = new PtyRegistry();
		expect(registry.count()).toBe(0);
		registry.register(seed(1));
		registry.register(seed(2));
		expect(registry.list()).toHaveLength(2);
		expect(registry.count()).toBe(2);
	});

	it("remove() drops the record and updates the secondary indexes", () => {
		const registry = new PtyRegistry();
		registry.register(seed(1, "lane-A", "sess-1"));
		registry.remove("pty-1");
		expect(registry.get("pty-1")).toBeUndefined();
		expect(registry.getByLane("lane-A")).toHaveLength(0);
		expect(registry.getBySession("sess-1")).toHaveLength(0);
		// Removing an unknown id is a no-op.
		expect(() => registry.remove("never-existed")).not.toThrow();
	});

	it("rejects registrations past the configured capacity", () => {
		const registry = new PtyRegistry(2);
		registry.register(seed(1));
		registry.register(seed(2));
		expect(() => registry.register(seed(3))).toThrow(RegistryCapacityError);
	});

	it("update() bumps the state and timestamp", async () => {
		const registry = new PtyRegistry();
		registry.register(seed(1));
		const before = registry.get("pty-1")?.updatedAt ?? 0;
		// Wait so timestamps differ.
		await new Promise((resolve) => setTimeout(resolve, 5));
		registry.update("pty-1", { state: "throttled" });
		expect(registry.get("pty-1")?.state).toBe("throttled");
		expect(registry.get("pty-1")?.updatedAt).toBeGreaterThan(before);
	});

	it("update() moves the record to a new lane/session index", () => {
		const registry = new PtyRegistry();
		registry.register(seed(1, "lane-A", "sess-1"));
		registry.update("pty-1", { laneId: "lane-B", sessionId: "sess-2" });
		expect(registry.getByLane("lane-A")).toHaveLength(0);
		expect(registry.getBySession("sess-1")).toHaveLength(0);
		expect(registry.getByLane("lane-B")).toHaveLength(1);
		expect(registry.getBySession("sess-2")).toHaveLength(1);
	});

	it("update() is a no-op for an unknown record", () => {
		const registry = new PtyRegistry();
		expect(() => registry.update("never", { state: "active" })).not.toThrow();
	});

	it("returns empty lists for unknown lane or session", () => {
		const registry = new PtyRegistry();
		expect(registry.getByLane("never")).toEqual([]);
		expect(registry.getBySession("never")).toEqual([]);
		expect(registry.get("never")).toBeUndefined();
	});
});
