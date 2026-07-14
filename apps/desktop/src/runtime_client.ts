import type { LocalBusEnvelope } from "../../runtime/src/protocol/types";
import type { RuntimeState } from "../../runtime/src/sessions/state_machine";
import type { LocalBus } from "../../runtime/src/protocol/bus";
import type { RendererEngine } from "./settings";
import type { TransportDiagnostics } from "./context_store";

type RuntimeResponse<T extends Record<string, unknown>> = {
  ok: boolean;
  result: T | null;
  error: string | null;
};

export type LifecycleResult = {
  ok: boolean;
  runtimeState: RuntimeState | null;
  id: string | null;
  diagnostics: TransportDiagnostics;
  error: string | null;
};

export type RendererCapabilities = {
  activeEngine: RendererEngine;
  availableEngines: RendererEngine[];
  hotSwapSupported: boolean;
};

export type RendererSwitchResult = {
  ok: boolean;
  activeEngine: RendererEngine;
  previousEngine: RendererEngine;
  error: string | null;
};

function toCommandEnvelope(
  method: string,
  payload: Record<string, unknown>,
  workspaceId: string | null,
  laneId: string | null,
  sessionId: string | null,
  terminalId: string | null
): LocalBusEnvelope {
  const correlationId = `${method}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: correlationId,
    type: "command",
    ts: new Date().toISOString(),
    correlation_id: correlationId,
    method,
    workspace_id: workspaceId ?? undefined,
    lane_id: laneId ?? undefined,
    session_id: sessionId ?? undefined,
    terminal_id: terminalId ?? undefined,
    payload,
  };
}

function toResponse<T extends Record<string, unknown>>(
  response: LocalBusEnvelope
): RuntimeResponse<T> {
  if (response.status === "error") {
    return {
      ok: false,
      result: null,
      error: response.error?.message ?? "runtime request failed",
    };
  }

  return {
    ok: true,
    result: (response.result as T | null) ?? null,
    error: null,
  };
}

function normalizeDiagnostics(result: Record<string, unknown> | null): TransportDiagnostics {
  const diagnostics = (result?.diagnostics as Record<string, unknown> | undefined) ?? {};
  return {
    preferredTransport:
      typeof diagnostics.preferred_transport === "string"
        ? diagnostics.preferred_transport
        : "cliproxy_harness",
    resolvedTransport:
      typeof diagnostics.resolved_transport === "string"
        ? diagnostics.resolved_transport
        : "cliproxy_harness",
    degradedReason:
      typeof diagnostics.degraded_reason === "string" ? diagnostics.degraded_reason : null,
    degradedAt: typeof diagnostics.degraded_at === "string" ? diagnostics.degraded_at : null,
  };
}

export class DesktopRuntimeClient {
  constructor(private readonly bus: LocalBus) {}

  async createLane(input: {
    workspaceId: string;
    preferredTransport?: string;
    simulateDegrade?: boolean;
    forceError?: boolean;
  }): Promise<LifecycleResult> {
    const requestedLaneId = `${input.workspaceId}:lane`;
    const response = await this.bus.request(
      toCommandEnvelope(
        "lane.create",
        {
          id: requestedLaneId,
          lane_id: requestedLaneId,
          preferred_transport: input.preferredTransport ?? "cliproxy_harness",
          simulate_degrade: input.simulateDegrade === true,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        requestedLaneId,
        null,
        null
      )
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    return {
      ok: parsed.ok,
      runtimeState: (parsed.result?.state as RuntimeState | undefined) ?? null,
      id: typeof parsed.result?.lane_id === "string" ? parsed.result.lane_id : null,
      diagnostics: normalizeDiagnostics(parsed.result),
      error: parsed.error,
    };
  }

  async ensureSession(input: {
    workspaceId: string;
    laneId: string;
    sessionId?: string;
    restore?: boolean;
    forceError?: boolean;
  }): Promise<LifecycleResult> {
    const requestedSessionId = input.sessionId ?? `${input.laneId}:session`;
    const response = await this.bus.request(
      toCommandEnvelope(
        "session.attach",
        {
          id: requestedSessionId,
          laneId: input.laneId,
          sessionId: requestedSessionId,
          restore: input.restore === true,
          forceError: input.forceError === true,
        },
        input.workspaceId,
        input.laneId,
        requestedSessionId,
        null
      )
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    return {
      ok: parsed.ok,
      runtimeState: (parsed.result?.state as RuntimeState | undefined) ?? null,
      id: typeof parsed.result?.session_id === "string" ? parsed.result.session_id : null,
      diagnostics: normalizeDiagnostics(parsed.result),
      error: parsed.error,
    };
  }

  async spawnTerminal(input: {
    workspaceId: string;
    laneId: string;
    sessionId: string;
    forceError?: boolean;
  }): Promise<LifecycleResult> {
    const requestedTerminalId = `${input.sessionId}:terminal`;
    const response = await this.bus.request(
      toCommandEnvelope(
        "terminal.spawn",
        {
          id: requestedTerminalId,
          lane_id: input.laneId,
          session_id: input.sessionId,
          terminal_id: requestedTerminalId,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        input.laneId,
        input.sessionId,
        requestedTerminalId
      )
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    return {
      ok: parsed.ok,
      runtimeState: (parsed.result?.state as RuntimeState | undefined) ?? null,
      id: typeof parsed.result?.terminal_id === "string" ? parsed.result.terminal_id : null,
      diagnostics: normalizeDiagnostics(parsed.result),
      error: parsed.error,
    };
  }

  async getRendererCapabilities(workspaceId: string | null): Promise<RendererCapabilities> {
    const response = await this.bus.request(
      toCommandEnvelope("renderer.capabilities", {}, workspaceId, null, null, null)
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    const activeEngine = parsed.result?.active_engine === "rio" ? "rio" : "ghostty";
    const available = Array.isArray(parsed.result?.available_engines)
      ? parsed.result.available_engines.filter(
          (value): value is RendererEngine => value === "ghostty" || value === "rio"
        )
      : (["ghostty", "rio"] as RendererEngine[]);
    return {
      activeEngine,
      availableEngines: available,
      hotSwapSupported: parsed.result?.hot_swap_supported !== false,
    };
  }

  async switchRenderer(input: {
    workspaceId: string | null;
    targetEngine: RendererEngine;
    forceError?: boolean;
  }): Promise<RendererSwitchResult> {
    const response = await this.bus.request(
      toCommandEnvelope(
        "renderer.switch",
        {
          target_engine: input.targetEngine,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        null,
        null,
        null
      )
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    return {
      ok: parsed.ok,
      activeEngine: parsed.result?.active_engine === "rio" ? "rio" : "ghostty",
      previousEngine: parsed.result?.previous_engine === "rio" ? "rio" : "ghostty",
      error: parsed.error,
    };
  }
}
