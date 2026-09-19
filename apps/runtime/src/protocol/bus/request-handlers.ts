// Request handler helpers for InMemoryLocalBus — extracted from emitter.ts for static analysis compliance.

import type { LocalBusEnvelope } from "../types.js";
import { publishLifecycleEvent } from "./lifecycle.js";
import type { MetricsRecorder } from "./metrics.js";
import type { AuditRecord, BusState } from "./types.js";

/**
 * Shared context passed to request handler functions.
 */
export interface RequestHandlerContext {
	state: BusState;
	lifecycleProgress: Map<string, Set<string>>;
	eventLog: LocalBusEnvelope[];
	auditLog: AuditRecord[];
	metricsRecorder: MetricsRecorder;
	rendererEngine: "ghostty" | "rio";
	setState(newState: BusState): void;
	setRendererEngine(engine: "ghostty" | "rio"): void;
}

export function handleLaneAttach(
	command: LocalBusEnvelope,
	ctx: RequestHandlerContext,
): LocalBusEnvelope {
	const correlationId = command.correlation_id ?? "";
	if (!ctx.lifecycleProgress.has(correlationId)) {
		ctx.lifecycleProgress.set(correlationId, new Set());
	}
	ctx.lifecycleProgress.get(correlationId)?.add("lane.attach.started");
	publishLifecycleEvent(
		"lane.attach.started",
		command,
		ctx.eventLog,
		ctx.auditLog,
	);

	const laneId =
		command.lane_id ?? command.payload?.lane_id ?? `lane_${Date.now()}`;

	ctx.lifecycleProgress.get(correlationId)?.add("lane.attached");
	publishLifecycleEvent("lane.attached", command, ctx.eventLog, ctx.auditLog);

	return {
		id: `res-${Date.now()}`,
		type: "response",
		ts: new Date().toISOString(),
		status: "ok",
		result: {
			lane_id: laneId,
		},
	};
}

export function handleLaneCleanup(
	command: LocalBusEnvelope,
	startTime: number,
	ctx: RequestHandlerContext,
): LocalBusEnvelope {
	const correlationId = command.correlation_id;
	if (!correlationId) {
		return {
			id: `res-${Date.now()}`,
			type: "response",
			ts: new Date().toISOString(),
			status: "error",
			error: {
				code: "MISSING_CORRELATION_ID",
				message: "correlation_id is required for lane.cleanup",
				retryable: false,
			},
		};
	}
	if (!ctx.lifecycleProgress.has(correlationId)) {
		ctx.lifecycleProgress.set(correlationId, new Set());
	}
	ctx.lifecycleProgress.get(correlationId)?.add("lane.cleanup.started");
	publishLifecycleEvent(
		"lane.cleanup.started",
		command,
		ctx.eventLog,
		ctx.auditLog,
	);
	publishLifecycleEvent("lane.cleaned", command, ctx.eventLog, ctx.auditLog);
	ctx.metricsRecorder.recordMetric(
		"lane_cleanup_latency_ms",
		Date.now() - startTime,
	);
	ctx.metricsRecorder.emitMetricEvent(
		"lane_cleanup_latency_ms",
		Date.now() - startTime,
		ctx.eventLog,
		ctx.auditLog,
	);
	const laneId = command.lane_id ?? command.payload?.lane_id;
	return {
		id: `res-${Date.now()}`,
		type: "response",
		ts: new Date().toISOString(),
		status: "ok",
		result: {
			lane_id: laneId,
			cleaned: true,
		},
	};
}

export function handleSessionTerminate(
	command: LocalBusEnvelope,
	startTime: number,
	ctx: RequestHandlerContext,
): LocalBusEnvelope {
	const correlationId = command.correlation_id;
	if (!correlationId) {
		return {
			id: `res-${Date.now()}`,
			type: "response",
			ts: new Date().toISOString(),
			status: "error",
			error: {
				code: "MISSING_CORRELATION_ID",
				message: "correlation_id is required for session.terminate",
				retryable: false,
			},
		};
	}
	if (!ctx.lifecycleProgress.has(correlationId)) {
		ctx.lifecycleProgress.set(correlationId, new Set());
	}
	ctx.lifecycleProgress.get(correlationId)?.add("session.terminate.started");
	publishLifecycleEvent(
		"session.terminate.started",
		command,
		ctx.eventLog,
		ctx.auditLog,
	);
	publishLifecycleEvent(
		"session.terminated",
		command,
		ctx.eventLog,
		ctx.auditLog,
	);
	ctx.setState({ session: "detached" });
	ctx.metricsRecorder.recordMetric(
		"session_terminate_latency_ms",
		Date.now() - startTime,
	);
	ctx.metricsRecorder.emitMetricEvent(
		"session_terminate_latency_ms",
		Date.now() - startTime,
		ctx.eventLog,
		ctx.auditLog,
	);
	const sessionId = command.session_id ?? command.payload?.session_id;
	return {
		id: `res-${Date.now()}`,
		type: "response",
		ts: new Date().toISOString(),
		status: "ok",
		result: {
			session_id: sessionId,
			terminated: true,
		},
	};
}
