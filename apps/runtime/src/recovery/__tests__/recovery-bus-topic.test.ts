import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EventEnvelope } from "../../protocol/bus.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { type CrashEvent, CrashReason, Watchdog } from "../watchdog.js";

// Traces to: F5 — public `recovery.crash.detected` bus topic + contract test.
//
// Why this test exists:
//   The slice-2 wiring internally subscribes to the watchdog's crash
//   event via `Watchdog.onCrashDetected(callback)` and routes it
//   through `CrashLoopDetector` → `SafeMode`. That path is fully
//   covered by `apps/runtime/src/recovery/__tests__/durability-layer.test.ts`.
//   External consumers (telemetry, dashboards, third-party agents) do
//   not have access to `Watchdog.onCrashDetected` — they only see the
//   bus API. Slice 6 / F5 promotes `recovery.crash.detected` from
//   "an event that ends up in the eventLog" to "an event external
//   consumers can subscribe to and receive synchronously with
//   detection".
//
// What this test asserts:
//   1. A `bus.subscribe("recovery.crash.detected", handler)` call
//      returns an unsubscribe handle that actually removes the handler.
//   2. After a watchdog detection (heartbeat timeout + non-graceful
//      process exit), the subscriber receives an `EventEnvelope` whose
//      `topic === "recovery.crash.detected"` and whose `payload` is
//      the `CrashEvent` shape (name, pid, reason, exitCode?, signal?,
//      timestamp) — the same shape `getEvents()` exposes, so external
//      consumers don't need a separate code path.
//   3. Subscriber errors do not propagate to the publisher (FR-009
//      subscriber isolation) — one bad consumer cannot break delivery
//      to others.
//   4. Order: the bus subscriber fires synchronously with `publish()`,
//      which means subscribers observe the crash before any later
//      durability-layer side-effect (safe-mode entry, recovery state
//      machine transition, etc.) settles. We assert this by checking
//      that the subscriber's sequence number is monotonic across two
//      consecutive crashes on the same bus.

describe("F5 — public recovery.crash.detected bus topic", () => {
	let watchdog: Watchdog;
	let tempDir: string;
	let bus: InMemoryLocalBus;

	beforeEach(async () => {
		vi.useFakeTimers();
		tempDir = path.join(os.tmpdir(), `f5-recovery-topic-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
		bus = new InMemoryLocalBus();
		watchdog = new Watchdog(tempDir, bus);
	});

	afterEach(async () => {
		await watchdog.waitForIdle();
		watchdog.dispose();
		vi.restoreAllMocks();
		vi.useRealTimers();
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("delivers heartbeat-timeout crashes to bus.subscribe('recovery.crash.detected')", async () => {
		const received: EventEnvelope[] = [];
		const unsubscribe = bus.subscribe("recovery.crash.detected", (evt) => {
			received.push(evt);
		});

		watchdog.registerProcess("f5-heartbeat-proc", 4242, 1000);
		vi.advanceTimersByTime(2100); // 2 * 1000 + 100ms
		await watchdog.waitForIdle();

		expect(received.length).toBe(1);
		expect(received[0].type).toBe("event");
		expect(received[0].topic).toBe("recovery.crash.detected");
		expect(received[0].payload).toBeDefined();
		const payload = received[0].payload as CrashEvent;
		expect(payload.name).toBe("f5-heartbeat-proc");
		expect(payload.pid).toBe(4242);
		expect(payload.reason).toBe(CrashReason.HEARTBEAT_TIMEOUT);
		expect(typeof payload.timestamp).toBe("number");

		unsubscribe();
	});

	it("delivers non-graceful process exit (exit code 1) to subscribers", async () => {
		const received: EventEnvelope[] = [];
		bus.subscribe("recovery.crash.detected", (evt) => received.push(evt));

		watchdog.registerProcess("f5-exit-proc", 7777, 2000);
		await watchdog.handleProcessExit("f5-exit-proc", 7777, 1);
		await watchdog.waitForIdle();

		expect(received.length).toBe(1);
		const payload = received[0].payload as CrashEvent;
		expect(payload.name).toBe("f5-exit-proc");
		expect(payload.pid).toBe(7777);
		expect(payload.reason).toBe(CrashReason.EXIT_CODE);
		expect(payload.exitCode).toBe(1);
		expect(payload.signal).toBeUndefined();
	});

	it("does NOT deliver graceful exit (code 0) or SIGTERM to subscribers", async () => {
		const received: EventEnvelope[] = [];
		bus.subscribe("recovery.crash.detected", (evt) => received.push(evt));

		watchdog.registerProcess("f5-graceful-proc", 8888, 2000);
		await watchdog.handleProcessExit("f5-graceful-proc", 8888, 0);
		await watchdog.handleProcessExit(
			"f5-term-proc",
			8889,
			undefined,
			"SIGTERM",
		);

		expect(received.length).toBe(0);
	});

	it("delivers SIGKILL to subscribers", async () => {
		const received: EventEnvelope[] = [];
		bus.subscribe("recovery.crash.detected", (evt) => received.push(evt));

		watchdog.registerProcess("f5-kill-proc", 9999, 2000);
		await watchdog.handleProcessExit(
			"f5-kill-proc",
			9999,
			undefined,
			"SIGKILL",
		);

		expect(received.length).toBe(1);
		const payload = received[0].payload as CrashEvent;
		expect(payload.reason).toBe(CrashReason.SIGNAL);
		expect(payload.signal).toBe("SIGKILL");
	});

	it("assigns monotonically increasing sequence numbers to subscribers across crashes", async () => {
		const received: EventEnvelope[] = [];
		bus.subscribe("recovery.crash.detected", (evt) => received.push(evt));

		watchdog.registerProcess("f5-seq-proc-a", 5001, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();

		watchdog.registerProcess("f5-seq-proc-b", 5002, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();

		expect(received.length).toBe(2);
		expect(received[0].sequence).toBeDefined();
		expect(received[1].sequence).toBeDefined();
		expect((received[1].sequence ?? 0) > (received[0].sequence ?? 0)).toBe(
			true,
		);
	});

	it("delivers to bus subscribers before internal crash handlers run", async () => {
		const order: string[] = [];
		bus.subscribe("recovery.crash.detected", () =>
			order.push("bus-subscriber"),
		);
		watchdog.onCrashDetected(() => order.push("watchdog-handler"));

		watchdog.registerProcess("f5-order-proc", 5555, 2000);
		await watchdog.handleProcessExit("f5-order-proc", 5555, 1);
		await watchdog.waitForIdle();

		// `handleCrash()` awaits `bus.publish()` before invoking the internal
		// crash handlers, so recording this order proves delivery is synchronous
		// with publish() rather than deferred. A deferred dispatch would put
		// "watchdog-handler" first and fail here.
		expect(order).toEqual(["bus-subscriber", "watchdog-handler"]);
	});

	it("the unsubscribe handle stops further deliveries", async () => {
		const received: EventEnvelope[] = [];
		const unsubscribe = bus.subscribe("recovery.crash.detected", (evt) => {
			received.push(evt);
		});

		watchdog.registerProcess("f5-unsub-proc-a", 6001, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();
		expect(received.length).toBe(1);

		unsubscribe();

		watchdog.registerProcess("f5-unsub-proc-b", 6002, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();
		expect(received.length).toBe(1); // no new deliveries after unsubscribe
	});

	it("isolates subscriber errors (FR-009): a throwing handler does not break delivery to others", async () => {
		const secondReceived: EventEnvelope[] = [];
		bus.subscribe("recovery.crash.detected", () => {
			throw new Error("subscriber blew up on purpose");
		});
		bus.subscribe("recovery.crash.detected", (evt) => {
			secondReceived.push(evt);
		});

		watchdog.registerProcess("f5-isolation-proc", 7001, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();

		expect(secondReceived.length).toBe(1);
		const payload = secondReceived[0].payload as CrashEvent;
		expect(payload.name).toBe("f5-isolation-proc");
	});

	it("does not deliver events to subscribers of other topics", async () => {
		const received: EventEnvelope[] = [];
		bus.subscribe("recovery.safemode.entered", (evt) => received.push(evt));

		watchdog.registerProcess("f5-topic-isolation-proc", 8001, 1000);
		vi.advanceTimersByTime(2100);
		await watchdog.waitForIdle();

		expect(received.length).toBe(0);
	});
});
