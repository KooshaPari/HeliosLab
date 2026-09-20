/**
 * Durability wiring for `createRuntime`. Extracted from
 * `apps/runtime/src/index.ts` so the runtime entry stays under the
 * file-length no-growth baseline.
 *
 * The factory returns three closures plus a `getDurability` accessor
 * so the runtime can:
 * - lazily construct the {@link DurabilityLayer} on first request,
 * - subscribe the bus activity topics that bump the activity counter,
 * - shut everything down on `close()` and remain idempotent across
 *   repeated calls.
 *
 * Public API on the runtime does not change; only the implementation
 * location does.
 */

import type { CheckpointSession } from "./recovery/checkpoint.js";
import { resolveDefaultDataDir } from "./recovery/data-dir.js";
import { DurabilityLayer } from "./recovery/durability_layer.js";
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
	bus: { subscribe: (topic: string, handler: () => void) => () => void };
	recovery: RecoveryRegistry;
	terminalRegistry: TerminalRegistry;
	dataDir?: string;
}

export interface DurabilityBundle {
	ensureDurability(): Promise<DurabilityLayer>;
	subscribeBusForActivity(): void;
	closeDurability(): Promise<void>;
	getDurability(): Promise<DurabilityLayer>;
}

/**
 * Wire a runtime's recovery, terminal registry, and bus into a
 * lazily-constructed {@link DurabilityLayer}. The returned bundle
 * is internally idempotent.
 */
export function attachDurability(ctx: DurabilityContext): DurabilityBundle {
	let durability: DurabilityLayer | undefined;
	const durabilitySubscribers: Array<() => void> = [];

	function buildCheckpointSessions(): CheckpointSession[] {
		const lanes = ctx.recovery.snapshot();
		const laneById = new Map(lanes.lanes.map((lane) => [lane.lane_id, lane]));
		const sessions: CheckpointSession[] = [];
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

	async function ensureDurability(): Promise<DurabilityLayer> {
		if (durability) return durability;
		const dataDir =
			ctx.dataDir !== undefined && ctx.dataDir.length > 0
				? ctx.dataDir
				: await resolveDefaultDataDir();
		durability = new DurabilityLayer({ dataDir });
		durability.start(buildCheckpointSessions);
		subscribeBusForActivity();
		return durability;
	}

	function subscribeBusForActivity(): void {
		for (const topic of ACTIVITY_TOPICS) {
			durabilitySubscribers.push(
				ctx.bus.subscribe(topic, () => {
					durability?.recordActivity();
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
			await durability.shutdown();
		}
	}

	async function getDurability(): Promise<DurabilityLayer> {
		return ensureDurability();
	}

	return {
		ensureDurability,
		subscribeBusForActivity,
		closeDurability,
		getDurability,
	};
}
