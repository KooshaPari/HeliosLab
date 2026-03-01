import type { LocalBusEnvelope } from "../runtime/protocol/types";
import type { RuntimeState } from "../runtime/sessions/state_machine";
import type { LocalBus } from "../runtime/protocol/bus";
import type { RendererEngine } from "./settings";
import type { TransportDiagnostics } from "./context_store";

interface RuntimeResponse<T extends Record<string, unknown>> {
  ok: boolean;
  result: T | null;
  error: string | null;
}

export interface LifecycleResult {
  ok: boolean;
  runtimeState: RuntimeState | null;
  id: string | null;
  diagnostics: TransportDiagnostics;
  error: string | null;
}

export interface RendererCapabilities {
  activeEngine: RendererEngine;
  availableEngines: RendererEngine[];
  hotSwapSupported: boolean;
}

export interface RendererSwitchResult {
  ok: boolean;
  activeEngine: RendererEngine;
  previousEngine: RendererEngine;
  error: string | null;
}

function toCommandEnvelope(
  method: string,
  payload: Record<string, unknown>,
  workspaceId: string | null,
  sessionId: string | null,
  terminalId: string | null,
): LocalBusEnvelope {
  return {
    id: `${method}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    type: "command",
    ts: new Date().toISOString(),
    method,
    workspace_id: workspaceId ?? undefined,
    session_id: sessionId ?? undefined,
    terminal_id: terminalId ?? undefined,
    payload,
  };
}

function toResponse<T extends Record<string, unknown>>(
  response: LocalBusEnvelope,
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
    result: (response.result as T | null) ?? ({} as T | null),
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
  private readonly bus: LocalBus;

  constructor(bus: LocalBus) {
    this.bus = bus;
  }

  async createLane(input: {
    workspaceId: string;
    preferredTransport?: string;
    simulateDegrade?: boolean;
    forceError?: boolean;
  }): Promise<LifecycleResult> {
    const response = await this.bus.request(
      toCommandEnvelope(
        "lane.create",
        {
          preferred_transport: input.preferredTransport ?? "cliproxy_harness",
          simulate_degrade: input.simulateDegrade === true,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        null,
        null,
      ),
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
    forceError?: boolean;
  }): Promise<LifecycleResult> {
    const response = await this.bus.request(
      toCommandEnvelope(
        "session.attach",
        {
          id: `${input.laneId}:session`,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        null,
        null,
      ),
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
    const response = await this.bus.request(
      toCommandEnvelope(
        "terminal.spawn",
        {
          id: `${input.sessionId}:terminal`,
          lane_id: input.laneId,
          force_error: input.forceError === true,
        },
        input.workspaceId,
        input.sessionId,
        null,
      ),
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
      toCommandEnvelope("renderer.capabilities", {}, workspaceId, null, null),
    );
    const parsed = toResponse<Record<string, unknown>>(response);
    const activeEngine = parsed.result?.active_engine === "rio" ? "rio" : "ghostty";
    const available = Array.isArray(parsed.result?.available_engines)
      ? (parsed.result.available_engines.filter(
          (value): value is RendererEngine => value === "ghostty" || value === "rio",
        ) as RendererEngine[])
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
      ),
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
