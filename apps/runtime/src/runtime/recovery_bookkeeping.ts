/**
 * Recovery-bookkeeping helpers extracted from `apps/runtime/src/index.ts`
 * so the runtime entry stays under the file-length no-growth baseline.
 *
 * The single entry point, {@link applyRecoveryFromCommand}, records a
 * `recovery.apply()` side-effect for every successful command/response
 * pair that maps onto a recoverable lifecycle event (`lane.create`,
 * `session.attach`, `terminal.spawn`, ...). All workspace / lane /
 * session / terminal ids are pulled from the envelope pair using a
 * uniform precedence (envelope field → payload field → result field)
 * so the bookkeeping is symmetric across commands.
 */

import type { LocalBusEnvelope } from "../protocol/types.js";
import { normalizePayload } from "../redaction.js";
import type { RecoveryRegistry } from "../sessions/registry.js";

/**
 * Run a successful command/response pair through the recovery registry so
 * the runtime remembers the lane/session/terminal it just produced.
 *
 * Side-effects only fire when the response is `status === "ok"` and the
 * command has a method — error responses are intentionally ignored
 * because a failure does not allocate any of the ids the registry tracks.
 */
export function applyRecoveryFromCommand(
	recovery: RecoveryRegistry,
	command: LocalBusEnvelope,
	response: LocalBusEnvelope,
): void {
	if (
		response.type !== "response" ||
		response.status !== "ok" ||
		!command.method
	) {
		return;
	}

	const payload = normalizePayload(command.payload);
	const result = normalizePayload(response.result);

	recovery.apply(command.method, {
		workspace_id: command.workspace_id,
		lane_id:
			command.lane_id ??
			(typeof payload.lane_id === "string" ? payload.lane_id : undefined) ??
			(typeof payload.id === "string" && command.method === "lane.create"
				? payload.id
				: undefined) ??
			(typeof result.lane_id === "string" ? result.lane_id : undefined),
		session_id:
			command.session_id ??
			(typeof payload.session_id === "string"
				? payload.session_id
				: undefined) ??
			(typeof payload.id === "string" && command.method === "session.attach"
				? payload.id
				: undefined) ??
			(typeof result.session_id === "string" ? result.session_id : undefined),
		terminal_id:
			command.terminal_id ??
			(typeof payload.terminal_id === "string"
				? payload.terminal_id
				: undefined) ??
			(typeof payload.id === "string" && command.method === "terminal.spawn"
				? payload.id
				: undefined) ??
			(typeof result.terminal_id === "string" ? result.terminal_id : undefined),
		codex_session_id:
			typeof payload.codex_session_id === "string"
				? payload.codex_session_id
				: undefined,
	});
}
