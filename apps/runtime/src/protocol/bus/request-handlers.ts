// Request handler helpers for InMemoryLocalBus — extracted from emitter.ts for static analysis compliance.

import type { LocalBusEnvelope } from "../types.js";
import type { AuditRecord, BusState } from "./types.js";
import { publishLifecycleEvent } from "./lifecycle.js";
import type { MetricsRecorder } from "./metrics.js";
import { hasTopLevelDataField } from "./validation.js";

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
  ctx: RequestHandlerContext
): LocalBusEnvelope {
  const correlationId = command.correlation_id ?? "";
  if (!ctx.lifecycleProgress.has(correlationId)) {
    ctx.lifecycleProgress.set(correlationId, new Set());
  }
  ctx.lifecycleProgress.get(correlationId)?.add("lane.attach.started");
  publishLifecycleEvent("lane.attach.started", command, ctx.eventLog, ctx.auditLog);

  const laneId = command.lane_id ?? command.payload?.lane_id ?? `lane_${Date.now()}`;

  ctx.lifecycleProgress.get(correlationId)?.add("lane.attached");
  publishLifecycleEvent("lane.attached", command, ctx.eventLog, ctx.auditLog);

  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      lane_id: laneId,
    },
  };
}

export function handleLaneCreate(
  command: LocalBusEnvelope,
  startTime: number,
  ctx: RequestHandlerContext
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
        message: "correlation_id is required for lane.create",
        retryable: false,
      },
    };
  }
  if (!ctx.lifecycleProgress.has(correlationId)) {
    ctx.lifecycleProgress.set(correlationId, new Set());
  }
  ctx.lifecycleProgress.get(correlationId)?.add("lane.create.started");
  publishLifecycleEvent("lane.create.started", command, ctx.eventLog, ctx.auditLog);
  publishLifecycleEvent("lane.created", command, ctx.eventLog, ctx.auditLog);
  ctx.metricsRecorder.recordMetric("lane_create_latency_ms", Date.now() - startTime);
  ctx.metricsRecorder.emitMetricEvent(
    "lane_create_latency_ms",
    Date.now() - startTime,
    ctx.eventLog,
    ctx.auditLog
  );
  const resultId = command.payload?.id ?? command.payload?.lane_id ?? `lane_${Date.now()}`;
  const preferredTransport =
    typeof command.payload?.preferred_transport === "string"
      ? command.payload.preferred_transport
      : "cliproxy_harness";
  const degraded = command.payload?.simulate_degrade === true;
  const resolvedTransport = degraded ? "native_openai" : preferredTransport;
  const degradedReason = degraded ? "cliproxy_harness_unhealthy" : null;
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      lane_id: resultId,
      state: ctx.state,
      diagnostics: {
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        preferred_transport: preferredTransport,
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        resolved_transport: resolvedTransport,
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_reason: degradedReason,
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_at: degraded ? new Date().toISOString() : null,
      },
    },
  };
}

export function handleSessionAttach(
  command: LocalBusEnvelope,
  startTime: number,
  ctx: RequestHandlerContext
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
        message: "correlation_id is required for session.attach",
        retryable: false,
      },
    };
  }
  const forceError = command.payload?.force_error === true;

  if (!ctx.lifecycleProgress.has(correlationId)) {
    ctx.lifecycleProgress.set(correlationId, new Set());
  }
  ctx.lifecycleProgress.get(correlationId)?.add("session.attach.started");
  publishLifecycleEvent("session.attach.started", command, ctx.eventLog, ctx.auditLog);

  if (forceError) {
    ctx.lifecycleProgress.get(correlationId)?.add("session.attach.failed");
    publishLifecycleEvent("session.attach.failed", command, ctx.eventLog, ctx.auditLog);
    ctx.setState({ session: "detached" });
    return {
      id: `res-${Date.now()}`,
      type: "response",
      ts: new Date().toISOString(),
      status: "error",
      error: {
        code: "SESSION_ATTACH_FAILED",
        message: "forced error",
        retryable: false,
      },
    };
  }

  const isRestore = command.payload?.restore === true;
  if (isRestore) {
    const restoreStart = Date.now();
    publishLifecycleEvent("session.restore.started", command, ctx.eventLog, ctx.auditLog);
    ctx.metricsRecorder.recordMetric("session_restore_latency_ms", Date.now() - restoreStart);
    ctx.metricsRecorder.emitMetricEvent(
      "session_restore_latency_ms",
      Date.now() - restoreStart,
      ctx.eventLog,
      ctx.auditLog
    );
  }

  ctx.lifecycleProgress.get(correlationId)?.add("session.attached");
  publishLifecycleEvent("session.attached", command, ctx.eventLog, ctx.auditLog);
  if (isRestore) {
    publishLifecycleEvent("session.restore.completed", command, ctx.eventLog, ctx.auditLog);
  }
  ctx.setState({ session: "attached" });
  const sessionResultId =
    command.session_id ??
    command.payload?.id ??
    command.payload?.session_id ??
    `session_${Date.now()}`;
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      session_id: sessionResultId,
      state: ctx.state,
      diagnostics: {
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        preferred_transport: "cliproxy_harness",
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        resolved_transport: "cliproxy_harness",
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_reason: null,
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_at: null,
      },
    },
  };
}

export function handleTerminalSpawn(
  command: LocalBusEnvelope,
  startTime: number,
  ctx: RequestHandlerContext
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
        message: "correlation_id is required for terminal.spawn",
        retryable: false,
      },
    };
  }
  const forceError = command.payload?.force_error === true;

  const terminalResultId: string =
    String(command.payload?.id ?? command.payload?.terminal_id ?? "") || `terminal_${Date.now()}`;

  // Ensure all terminal lifecycle events include terminal context.
  // Only assign if not already set to avoid overwriting existing terminal_id
  if (!command.terminal_id) {
    command.terminal_id = terminalResultId;
  }

  if (!ctx.lifecycleProgress.has(correlationId)) {
    ctx.lifecycleProgress.set(correlationId, new Set());
  }
  ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawn.started");
  publishLifecycleEvent("terminal.spawn.started", command, ctx.eventLog, ctx.auditLog);

  if (forceError) {
    ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawn.failed");
    publishLifecycleEvent("terminal.spawn.failed", command, ctx.eventLog, ctx.auditLog);
    return {
      id: `res-${Date.now()}`,
      type: "response",
      ts: new Date().toISOString(),
      status: "error",
      error: {
        code: "TERMINAL_SPAWN_FAILED",
        message: "forced error",
        retryable: false,
      },
    };
  }

  // Emit state change events before final spawned event
  publishLifecycleEvent("terminal.state.changed", command, ctx.eventLog, ctx.auditLog);
  ctx.setState({ ...ctx.state, terminal: "active" });
  publishLifecycleEvent("terminal.state.changed", command, ctx.eventLog, ctx.auditLog);
  ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawned");
  publishLifecycleEvent("terminal.spawned", command, ctx.eventLog, ctx.auditLog);
  ctx.metricsRecorder.recordMetric("terminal_spawn_latency_ms", Date.now() - startTime);
  ctx.metricsRecorder.emitMetricEvent(
    "terminal_spawn_latency_ms",
    Date.now() - startTime,
    ctx.eventLog,
    ctx.auditLog
  );
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      terminal_id: terminalResultId,
      state: ctx.state,
      diagnostics: {
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        preferred_transport: "cliproxy_harness",
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        resolved_transport: "cliproxy_harness",
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_reason: null,
        // biome-ignore lint/style/useNamingConvention: Protocol diagnostics fields use snake_case.
        degraded_at: null,
      },
    },
  };
}

export function handleTerminalInput(command: LocalBusEnvelope): LocalBusEnvelope {
  // Validate data field
  if (
    command.payload?.data === undefined &&
    !hasTopLevelDataField(command as Record<string, unknown>)
  ) {
    return {
      id: `res-${Date.now()}`,
      type: "response",
      ts: new Date().toISOString(),
      status: "error",
      error: {
        code: "INVALID_TERMINAL_INPUT",
        message: "payload.data is required",
        retryable: false,
      },
    };
  }

  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {},
  };
}

export function handleRendererCapabilities(rendererEngine: "ghostty" | "rio"): LocalBusEnvelope {
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      active_engine: rendererEngine ?? "ghostty",
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      available_engines: ["ghostty", "rio"],
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      hot_swap_supported: true,
    },
  };
}

export function handleRendererSwitch(
  command: LocalBusEnvelope,
  ctx: RequestHandlerContext
): LocalBusEnvelope {
  const nextEngine = command.payload?.target_engine;
  const forceError = command.payload?.force_error === true;
  const previousEngine = ctx.rendererEngine ?? "ghostty";

  if (forceError) {
    return {
      id: `res-${Date.now()}`,
      type: "response",
      ts: new Date().toISOString(),
      status: "error",
      error: {
        code: "RENDERER_SWITCH_FAILED",
        message: "forced error",
        retryable: false,
      },
      result: {
        // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
        active_engine: previousEngine,
        // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
        previous_engine: previousEngine,
      },
    };
  }

  ctx.setRendererEngine(nextEngine === "rio" ? "rio" : "ghostty");
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      active_engine: ctx.rendererEngine,
      // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
      previous_engine: previousEngine,
    },
  };
}
