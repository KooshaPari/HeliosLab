import type { LocalBusEnvelope } from "./types.js";
import type { BusState } from "./bus_in_memory.js";

type InMemoryRequestContext = {
  getState(): BusState;
  setState(state: BusState): void;
  lifecycleProgress: Map<string, Set<string>>;
  publishLifecycleEvent(topic: string, envelope: LocalBusEnvelope): void;
  recordMetric(metric: string, value?: number): void;
  emitMetricEvent(metric: string, value?: number): void;
  getRendererEngine(): "ghostty" | "rio";
  setRendererEngine(engine: "ghostty" | "rio"): void;
};

function makeErrorResponse(
  command: LocalBusEnvelope,
  code: string,
  message: string
): LocalBusEnvelope {
  return {
    id: `res-${Date.now()}`,
    type: "response",
    ts: new Date().toISOString(),
    status: "error",
    // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
    correlation_id: command.correlation_id,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

export async function handleInMemoryRequest(
  ctx: InMemoryRequestContext,
  command: LocalBusEnvelope
): Promise<LocalBusEnvelope> {
  await Promise.resolve();

  if (command.method) {
    const needsCorrelation = [
      "lane.create",
      "session.attach",
      "terminal.spawn",
      "terminal.input",
      "terminal.resize",
    ];
    if (needsCorrelation.includes(command.method) && !command.correlation_id) {
      return makeErrorResponse(command, "MISSING_CORRELATION_ID", "correlation_id is required");
    }

    const _startTime = Date.now();

    if (command.method === "lane.create") {
      const correlationId = command.correlation_id;
      if (!correlationId) {
        return makeErrorResponse(
          command,
          "MISSING_CORRELATION_ID",
          "correlation_id is required for lane.create"
        );
      }
      if (!ctx.lifecycleProgress.has(correlationId)) {
        ctx.lifecycleProgress.set(correlationId, new Set());
      }
      ctx.lifecycleProgress.get(correlationId)?.add("lane.create.started");
      ctx.publishLifecycleEvent("lane.create.started", command);
      ctx.publishLifecycleEvent("lane.created", command);
      ctx.recordMetric("lane_create_latency_ms", Date.now() - startTime);
      ctx.emitMetricEvent("lane_create_latency_ms", Date.now() - startTime);
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
          state: ctx.getState(),
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

    if (command.method === "lane.attach") {
      const laneResultId = command.lane_id ?? command.payload?.lane_id ?? `lane_${Date.now()}`;
      return {
        id: `res-${Date.now()}`,
        type: "response",
        ts: new Date().toISOString(),
        status: "ok",
        result: {
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          lane_id: laneResultId,
          state: ctx.getState(),
        },
      };
    }

    if (command.method === "session.attach") {
      const correlationId = command.correlation_id;
      if (!correlationId) {
        return makeErrorResponse(
          command,
          "MISSING_CORRELATION_ID",
          "correlation_id is required for session.attach"
        );
      }
      const forceError = command.payload?.force_error === true;

      if (!ctx.lifecycleProgress.has(correlationId)) {
        ctx.lifecycleProgress.set(correlationId, new Set());
      }
      ctx.lifecycleProgress.get(correlationId)?.add("session.attach.started");
      ctx.publishLifecycleEvent("session.attach.started", command);

      if (forceError) {
        ctx.lifecycleProgress.get(correlationId)?.add("session.attach.failed");
        ctx.publishLifecycleEvent("session.attach.failed", command);
        ctx.setState({ session: "detached" });
        return makeErrorResponse(command, "SESSION_ATTACH_FAILED", "forced error");
      }

      const isRestore = command.payload?.restore === true;
      if (isRestore) {
        const restoreStart = Date.now();
        ctx.publishLifecycleEvent("session.restore.started", command);
        ctx.recordMetric("session_restore_latency_ms", Date.now() - restoreStart);
        ctx.emitMetricEvent("session_restore_latency_ms", Date.now() - restoreStart);
      }

      ctx.lifecycleProgress.get(correlationId)?.add("session.attached");
      ctx.publishLifecycleEvent("session.attached", command);
      if (isRestore) {
        ctx.publishLifecycleEvent("session.restore.completed", command);
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
          state: ctx.getState(),
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

    if (command.method === "terminal.spawn") {
      const correlationId = command.correlation_id;
      if (!correlationId) {
        return makeErrorResponse(
          command,
          "MISSING_CORRELATION_ID",
          "correlation_id is required for terminal.spawn"
        );
      }
      const forceError = command.payload?.force_error === true;

      if (!ctx.lifecycleProgress.has(correlationId)) {
        ctx.lifecycleProgress.set(correlationId, new Set());
      }
      ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawn.started");
      ctx.publishLifecycleEvent("terminal.spawn.started", command);

      if (forceError) {
        ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawn.failed");
        ctx.publishLifecycleEvent("terminal.spawn.failed", command);
        return makeErrorResponse(command, "TERMINAL_SPAWN_FAILED", "forced error");
      }

      ctx.publishLifecycleEvent("terminal.state.changed", command);
      ctx.setState({ ...ctx.getState(), terminal: "active" });
      ctx.publishLifecycleEvent("terminal.state.changed", command);
      ctx.lifecycleProgress.get(correlationId)?.add("terminal.spawned");
      ctx.publishLifecycleEvent("terminal.spawned", command);
      const terminalResultId =
        command.payload?.id ?? command.payload?.terminal_id ?? `terminal_${Date.now()}`;
      ctx.recordMetric("terminal_spawn_latency_ms", Date.now() - startTime);
      ctx.emitMetricEvent("terminal_spawn_latency_ms", Date.now() - startTime);
      return {
        id: `res-${Date.now()}`,
        type: "response",
        ts: new Date().toISOString(),
        status: "ok",
        result: {
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          terminal_id: terminalResultId,
          state: ctx.getState(),
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

    if (command.method === "terminal.input") {
      if (
        command.payload?.data === undefined &&
        !Object.prototype.hasOwnProperty.call(command, "data")
      ) {
        return makeErrorResponse(command, "INVALID_TERMINAL_INPUT", "payload.data is required");
      }

      return {
        id: `res-${Date.now()}`,
        type: "response",
        ts: new Date().toISOString(),
        status: "ok",
        result: {},
      };
    }

    if (command.method === "renderer.capabilities") {
      return {
        id: `res-${Date.now()}`,
        type: "response",
        ts: new Date().toISOString(),
        status: "ok",
        result: {
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          active_engine: ctx.getRendererEngine() ?? "ghostty",
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          available_engines: ["ghostty", "rio"],
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          hot_swap_supported: true,
        },
      };
    }

    if (command.method === "renderer.switch") {
      const nextEngine = command.payload?.target_engine;
      const forceError = command.payload?.force_error === true;
      const previousEngine = ctx.getRendererEngine() ?? "ghostty";

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
          active_engine: ctx.getRendererEngine(),
          // biome-ignore lint/style/useNamingConvention: Protocol response fields use snake_case.
          previous_engine: previousEngine,
        },
      };
    }
  }

  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result: {},
  };
}
