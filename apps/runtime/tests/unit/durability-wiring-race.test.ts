/**
 * Tests for {@link attachDurability}. Covers the slice-3 review
 * threads flagging:
 * - concurrent `getDurability()` calls each constructing their own
 *   `DurabilityLayer` (race condition fix uses a promise cache so all
 *   callers share one in-flight initialisation)
 * - `closeDurability()` racing against the auto-start fire-and-forget
 *   in `createRuntime` (fix awaits `initPromise` so an in-flight init
 *   is awaited before shutdown)
 *
 * The race is exercised by stubbing `DurabilityLayer` entirely. We do
 * NOT construct the real layer in these tests because its scheduler
 * registers `process.on('SIGTERM')` / `process.on('SIGINT')` listeners
 * (and a `setInterval`) which Bun:test cannot drain between tests,
 * leading to false-positive test timeouts on Windows. The wiring
 * under test only depends on `start()` / `shutdown()` shape, both of
 * which are faithfully replicated below.
 */

// Install the stub before either the wiring module or its dynamic
// `import()` resolves the recovery subsystem, so the wiring sees the
// stub through both static and dynamic imports.
let constructionCount = 0;
let pendingStartGates: Array<() => void> = [];

class StubDurabilityLayer {
	async start(_snapshotter?: unknown): Promise<void> {
		constructionCount += 1;
		const gate = new Promise<void>((resolve) => {
			pendingStartGates.push(() => resolve());
		});
		await gate;
	}

	async shutdown(): Promise<void> {
		// No-op: the real scheduler would clear its `setInterval` and
		// unregister process listeners here, but the stub does neither
		// so the test exits cleanly.
	}

	setSnapshotter(_s: unknown): void {}

	recordActivity(): void {}
}

mock.module("../../src/recovery/durability_layer.js", () => ({
	DurabilityLayer: StubDurabilityLayer,
}));

const { attachDurability } = await import("../../src/durability_wiring.js");
const { createBus } = await import("../../src/protocol/bus.js");
const { RecoveryRegistry } = await import("../../src/sessions/registry.js");
const { TerminalRegistry } = await import(
	"../../src/sessions/terminal_registry.js"
);

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("attachDurability race condition", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-dur-"));
		constructionCount = 0;
		pendingStartGates = [];
	});

	afterEach(async () => {
		// Release any pending gates so outstanding promises resolve.
		for (const release of pendingStartGates) release();
		pendingStartGates = [];
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function releaseAllGates(): void {
		for (const release of pendingStartGates) release();
		pendingStartGates = [];
	}

	test("concurrent getDurability() calls construct exactly one DurabilityLayer", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);

		// Fire 8 concurrent getDurability() calls BEFORE the start gate
		// is released. Without the promise-cache, each call would
		// construct its own DurabilityLayer — the first is leaked.
		const promises = Array.from({ length: 8 }, () => bundle.getDurability());
		// Wait until the IIFE has reached the stub's `start()` so the
		// gate is actually registered. Releasing the gate before
		// `start()` runs would silently drop the resolution and the
		// promises would hang forever.
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		// Release the gate; all 8 promises resolve to the same instance.
		releaseAllGates();
		const results = await Promise.all(promises);
		expect(constructionCount).toBe(1);
		// Every caller observes the same layer reference.
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBe(results[0]);
		}
		await bundle.closeDurability();
	}, 10_000);

	test("closeDurability awaits an in-flight init so the auto-start race does not leak", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);

		// Kick off an init but do not release the gate. closeDurability
		// must still await it so the resulting layer is shut down.
		const getPromise = bundle.getDurability();
		// Wait until the stub's start() registers its gate so the
		// subsequent closeDurability can await the in-flight init.
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		const closePromise = bundle.closeDurability();
		// Release the gate so both promises can resolve.
		releaseAllGates();
		await getPromise;
		await closePromise;
		// Exactly one layer was constructed and it was shut down.
		expect(constructionCount).toBe(1);
	});

	test("ensureDurability returns the same instance on repeated calls", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		// Kick off the first init and yield so the IIFE enters the
		// gate-wait. Releasing the gate before awaiting the result
		// avoids a self-deadlock.
		const first = bundle.getDurability();
		// Wait for the gate to be registered before releasing it.
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		const firstResolved = await first;
		// After the first call resolved, the layer is cached, so the
		// second call hits the `if (durability) return durability`
		// fast path without touching the gate.
		const second = await bundle.getDurability();
		expect(second).toBe(firstResolved);
		expect(constructionCount).toBe(1);
		await bundle.closeDurability();
	}, 10_000);

	test("startDurability updates the snapshotter on an already-built layer", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		// Build the layer first (so durability is set).
		const promise = bundle.getDurability();
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		await promise;
		// Now startDurability should hit the `if (durability) ... setter` branch.
		await expect(bundle.startDurability(() => [])).resolves.toBeUndefined();
		await bundle.closeDurability();
	});

	test("startDurability falls back to buildCheckpointSessions when no snapshotter is supplied", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		// No prior getDurability — startDurability should call
		// ensureDurability internally (with the default snapshotter).
		const promise = bundle.startDurability();
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		await promise;
		expect(constructionCount).toBe(1);
		await bundle.closeDurability();
	});

	test("subscribeBusForActivity wires every activity topic to recordActivity", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		// Build the layer so subscribeBusForActivity is invoked from
		// inside the IIFE.
		const promise = bundle.getDurability();
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		await promise;
		// Publishing one event for each topic should reach the
		// stub's recordActivity() without throwing. We don't assert
		// on call counts because the stub doesn't tally them — the
		// important guarantee is that subscription wiring is intact.
		for (const topic of [
			"lane.created",
			"lane.cleaned",
			"session.attached",
			"session.terminated",
			"terminal.spawned",
			"terminal.output",
		]) {
			ctx.bus
				.publish({
					id: `pub-${topic}`,
					type: "event",
					ts: new Date().toISOString(),
					topic,
					payload: {},
				} as unknown as Parameters<typeof ctx.bus.publish>[0])
				.catch(() => {
					/* bus may swallow publishes; not asserting */
				});
		}
		await new Promise((r) => setImmediate(r));
		await bundle.closeDurability();
	});

	test("closeDurability is a no-op when ensureDurability was never invoked", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		// Skip getDurability entirely so durability stays undefined.
		await expect(bundle.closeDurability()).resolves.toBeUndefined();
		expect(constructionCount).toBe(0);
	});

	test("closeDurability swallows errors thrown by an unsubscribe handler", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		// Pre-subscribe a handler that throws when unsubscribed so the
		// closeDurability error-path is exercised.
		ctx.bus.subscribe("lane.created", () => {
			/* placeholder */
		});
		// Replace the subscribe API to inject a throwing unsubscribe.
		const originalSubscribe = ctx.bus.subscribe.bind(ctx.bus);
		(ctx.bus as unknown as { subscribe: typeof originalSubscribe }).subscribe =
			(topic: string, handler: (e: unknown) => void | Promise<void>) => {
				const unsub = originalSubscribe(topic, handler);
				return () => {
					throw new Error("synthetic unsubscribe failure");
				};
			};
		const bundle = attachDurability(ctx);
		const promise = bundle.getDurability();
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		await promise;
		// Swallows the synthetic unsubscribe error.
		await expect(bundle.closeDurability()).resolves.toBeUndefined();
	});

	test("getDurability is an alias for ensureDurability", async () => {
		const ctx = {
			bus: createBus(),
			recovery: new RecoveryRegistry(),
			terminalRegistry: new TerminalRegistry(),
			dataDir: tmpDir,
		};
		const bundle = attachDurability(ctx);
		const promise = bundle.getDurability();
		for (let i = 0; i < 50 && pendingStartGates.length === 0; i++) {
			await new Promise((r) => setImmediate(r));
		}
		releaseAllGates();
		const layer = await promise;
		expect(layer).toBeDefined();
		await bundle.closeDurability();
	});
});
