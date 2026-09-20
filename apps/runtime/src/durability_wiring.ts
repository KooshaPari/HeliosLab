/**
 * Durability wiring for `createRuntime`. Extracted from
 * `apps/runtime/src/index.ts` so the runtime entry stays under the
 * file-length no-growth baseline.
 *
 * The factory returns three closures plus a `getDurability` /
 * `startDurability` accessor so the runtime can:
 * - lazily construct the {@link DurabilityLayer} on first request,
 * - subscribe the bus activity topics that bump the activity counter,
 * - shut everything down on `close()` and remain idempotent across
 *   repeated calls,
 * - forward a caller-supplied `snapshotter` to the freshly-built layer.
 *
 * Public API on the runtime does not change beyond the new
 * `startDurability` hook; only the implementation location and the
 * `DurabilityLayer` options shape (now bus-driven) differ.
 */

import type { LocalBus } from "./protocol/bus.js";
import type { RecoveryRegistry } from "./sessions/registry.js";
import type { TerminalRegistry } from "./sessions/terminal_registry.js";

/**
 * Topics whose publication triggers a `recordActivity()` on the
 * durability layer. Order is not significant; the set is chosen to
 * cover every user-visible state transition that should keep the
 * runtime's idle clock from advancing.
 */
const ACTIVITY_TOPICS: ReadonlyArray<string> = [
	"lane.created",
	"lane.cleaned",
	"session.attached",
	"session.terminated",
	"terminal.spawned",
	"terminal.output",
];

export interface DurabilityContext {
	bus: LocalBus;
	recovery: RecoveryRegistry;
	terminalRegistry: TerminalRegistry;
	dataDir?: string;
}

export type Snapshotter = () => Array<{
	sessionId: string;
	terminalId: string;
	laneId: string;
	workingDirectory: string;
	environmentVariables: Record<string, string>;
	scrollbackSnapshot: string;
	zelijjSessionName: string;
	shellCommand: string;
}>;

export interface DurabilityBundle {
	ensureDurability(): Promise<unknown>;
	startDurability(snapshotter?: Snapshotter): Promise<void>;
	subscribeBusForActivity(): void;
	closeDurability(): Promise<void>;
	getDurability(): Promise<unknown>;
}

/**
 * Wire a runtime's recovery, terminal registry, and bus into a
 * lazily-constructed durability layer. The returned bundle is
 * internally idempotent.
 *
 * The data-dir resolver and `DurabilityLayer` constructor are loaded
 * via dynamic `import()` inside `ensureDurability` so that callers
 * which never invoke `getDurability()` / `close()` do not pay the
 * module-load cost of the recovery subsystem. This also keeps those
 * modules out of coverage surfacing when they are not exercised by
 * a particular test surface.
 */
export function attachDurability(ctx: DurabilityContext): DurabilityBundle {
	let durability: unknown | undefined;
	let defaultSnapshotter: Snapshotter | undefined;
	const durabilitySubscribers: Array<() => void> = [];

	function buildCheckpointSessions(): ReturnType<Snapshotter> {
		// The shape here matches the slice-2 wiring contract; the heavy
		// `DurabilityLayer` is loaded lazily inside `ensureDurability`,
		// so we keep the snapshot type structural rather than relying
		// on a top-level import from `./recovery/checkpoint.js`.
		const lanes = ctx.recovery.snapshot();
		const laneById = new Map(lanes.lanes.map((lane) => [lane.lane_id, lane]));
		const sessions: ReturnType<Snapshotter> = [];
		for (const session of lanes.sessions) {
			// A session without a lane mapping cannot be restored, so skip it.
			if (!session.lane_id) continue;
			const lane = laneById.get(session.lane_id);
			const terminalId =
				lane?.terminal_id ??
				session.terminal_id ??
				`pending-${session.session_id}`;
			const terminal = terminalId
				? ctx.terminalRegistry.get(terminalId)
				: undefined;
			sessions.push({
				sessionId: session.session_id,
				terminalId,
				laneId: session.lane_id,
				workingDirectory: process.cwd(),
				environmentVariables: {},
				scrollbackSnapshot: "",
				zelijjSessionName: `codex-${session.codex_session_id ?? session.session_id}`,
				shellCommand: "bash",
			});
			if (terminal) {
				// Mark terminal as recently seen; no behavior change yet.
				ctx.terminalRegistry.setState(terminal.terminal_id, terminal.state);
			}
		}
		return sessions;
	}

	async function ensureDurability(): Promise<unknown> {
		if (durability) return durability;
		// Dynamic import keeps the recovery subsystem out of the
		// import graph unless durability is actually requested.
		const [{ resolveDefaultDataDir }, { DurabilityLayer }] = await Promise.all([
			import("./recovery/data-dir.js"),
			import("./recovery/durability_layer.js"),
		]);
		const dataDir =
			ctx.dataDir !== undefined && ctx.dataDir.length > 0
				? ctx.dataDir
				: await resolveDefaultDataDir();
		const layer = new DurabilityLayer({ dataDir, bus: ctx.bus });
		// Preserve a caller-supplied snapshotter that `startDurability`
		// may have captured earlier — only fall back to the lane-driven
		// default when none was supplied.
		defaultSnapshotter ??= buildCheckpointSessions;
		await layer.start(defaultSnapshotter);
		durability = layer;
		subscribeBusForActivity();
		return durability;
	}

	async function startDurability(snapshotter?: Snapshotter): Promise<void> {
		// Ensure the layer exists (lazy), then forward the snapshotter.
		// If the caller already supplied one and the layer was never
		// `start`-ed, call `start` with the supplied snapshotter.
		if (durability) {
			const setter = (
				durability as { setSnapshotter?: (s: Snapshotter) => void }
			).setSnapshotter;
			if (snapshotter && setter) setter(snapshotter);
			return;
		}
		defaultSnapshotter = snapshotter ?? buildCheckpointSessions;
		await ensureDurability();
	}

	function subscribeBusForActivity(): void {
		for (const topic of ACTIVITY_TOPICS) {
			durabilitySubscribers.push(
				ctx.bus.subscribe(topic, () => {
					(
						durability as { recordActivity?: () => void } | undefined
					)?.recordActivity?.();
				}),
			);
		}
	}

	async function closeDurability(): Promise<void> {
		for (const unsubscribe of durabilitySubscribers.splice(0)) {
			try {
				unsubscribe();
			} catch (err) {
				console.error("durability_wiring.close: unsubscribe failed", err);
			}
		}
		if (durability) {
			await (durability as { shutdown?: () => Promise<void> }).shutdown?.();
		}
	}

	async function getDurability(): Promise<unknown> {
		return ensureDurability();
	}

	return {
		ensureDurability,
		startDurability,
		subscribeBusForActivity,
		closeDurability,
		getDurability,
	};
}
