/**
 * @helios/runtime - Core runtime package for heliosApp.
 *
 * Exports foundational types and a lightweight integration runtime used by
 * the current test suite.
 */

import { InMemoryLocalBus } from "./protocol/bus.js";
import { createBoundaryDispatcher } from "./protocol/boundary_adapter.js";
import { METHODS } from "./protocol/methods.js";
import type { LocalBusEnvelope } from "./protocol/types.js";
import { RecoveryRegistry, InMemorySessionRegistry } from "./sessions/registry.js";
import {
  LaneLifecycleService,
  type RuntimeState,
  type LaneRecord,
} from "./sessions/state_machine.js";
import type { TerminalBuffer } from "./runtime/types.js";
import { TerminalRegistry } from "./sessions/terminal_registry.js";
import { handleRuntimeRequest } from "./runtime/ops.js";

import type {
  RecoveryBootstrapResult,
  RecoveryMetadata,
  WatchdogScanResult,
} from "./sessions/types.js";
import { RedactionEngine } from "./secrets/redaction-engine.js";
import { getDefaultRules } from "./secrets/redaction-rules.js";

/** Semantic version of the runtime package. */
export const VERSION = "0.0.1" as const;

/** Result of a runtime health check. */
export interface HealthCheckResult {
  readonly ok: boolean;
  readonly timestamp: number;
  readonly uptimeMs: number;
}

export type RuntimeAuditRecord = {
  recorded_at: string;
  type: "command" | "response" | "event";
  method?: string;
  topic?: string;
  correlation_id?: string;
  payload: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean } | null;
  envelope?: LocalBusEnvelope | Record<string, unknown>;
};

export type RuntimeAuditBundle = {
  count: number;
  records: RuntimeAuditRecord[];
  exported_at: string;
};

export type RuntimeOptions = {
  recovery_metadata?: RecoveryMetadata;
  harnessProbe?: {
    check(): Promise<{ ok: boolean; reason?: string | null }>;
  };
  terminalBufferCapBytes?: number;
};

type RuntimeInstance = ReturnType<typeof createRuntime>;

const _startTime = performance.now();
const _METHOD_SET = new Set<string>(METHODS);

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function redactStructuredValue(value: unknown, key?: string): unknown {
  const normalizedKey = key?.toLowerCase() ?? "";
  const shouldRedactKey =
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("token") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("password");

  if (shouldRedactKey && typeof value === "string" && value.length > 0) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map(item => redactStructuredValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactStructuredValue(entryValue, entryKey),
      ])
    );
  }

  return value;
}

function redactPayload(
  engine: RedactionEngine,
  payload: Record<string, unknown>,
  correlationId: string
): Record<string, unknown> {
  const structured = redactStructuredValue(payload) as Record<string, unknown>;
  const serialized = JSON.stringify(structured);
  const result = engine.redact(serialized, {
    artifactId: `audit-${correlationId}`,
    artifactType: "audit",
    correlationId,
  });
  return JSON.parse(result.redacted) as Record<string, unknown>;
}

/** Returns the current health status of the runtime. */
export function healthCheck(): HealthCheckResult {
  return {
    ok: true,
    timestamp: Date.now(),
    uptimeMs: performance.now() - _startTime,
  };
}

export function createRuntime(options: RuntimeOptions = {}) {
  const innerBus = new InMemoryLocalBus();
  const bus = new Proxy(innerBus, {
    get(target, prop) {
      if (prop === "request") {
        return (command: LocalBusEnvelope) => request(command);
      }
      const value = (target as any)[prop];
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as InMemoryLocalBus;
  const recovery = new RecoveryRegistry();
  const sessionRegistry = new InMemorySessionRegistry();
  const terminalRegistry = new TerminalRegistry();
  const laneService = new LaneLifecycleService(bus);
  const redactionEngine = new RedactionEngine();
  redactionEngine.loadRules(getDefaultRules());

  const auditRecords: RuntimeAuditRecord[] = [];
  let bootstrapResult: RecoveryBootstrapResult | null = null;

  if (options.recovery_metadata) {
    bootstrapResult = recovery.bootstrap(options.recovery_metadata);
  }

  function appendAuditRecord(record: RuntimeAuditRecord): void {
    auditRecords.push(record);
  }

  function recordCommand(envelope: LocalBusEnvelope): void {
    appendAuditRecord({
      recorded_at: new Date().toISOString(),
      type: "command",
      method: envelope.method,
      correlation_id: envelope.correlation_id,
      envelope,
      payload: redactPayload(
        redactionEngine,
        normalizePayload(envelope.payload),
        envelope.correlation_id ?? envelope.id
      ),
      error: null,
    });
  }

  function recordResponse(envelope: LocalBusEnvelope): void {
    appendAuditRecord({
      recorded_at: new Date().toISOString(),
      type: "response",
      method: envelope.method,
      correlation_id: envelope.correlation_id,
      envelope,
      payload: redactPayload(
        redactionEngine,
        normalizePayload(envelope.result ?? envelope.payload),
        envelope.correlation_id ?? envelope.id
      ),
      error: envelope.error ?? null,
    });
  }

  function applyRecoveryFromCommand(command: LocalBusEnvelope, response: LocalBusEnvelope): void {
    if (response.type !== "response" || response.status !== "ok" || !command.method) {
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
        (typeof payload.session_id === "string" ? payload.session_id : undefined) ??
        (typeof payload.id === "string" && command.method === "session.attach"
          ? payload.id
          : undefined) ??
        (typeof result.session_id === "string" ? result.session_id : undefined),
      terminal_id:
        command.terminal_id ??
        (typeof payload.terminal_id === "string" ? payload.terminal_id : undefined) ??
        (typeof payload.id === "string" && command.method === "terminal.spawn"
          ? payload.id
          : undefined) ??
        (typeof result.terminal_id === "string" ? result.terminal_id : undefined),
      codex_session_id:
        typeof payload.codex_session_id === "string" ? payload.codex_session_id : undefined,
    });
  }

  const terminalBuffers = new Map<string, TerminalBuffer>();
  const terminalBufferCap = options.terminalBufferCapBytes ?? 1024;
  let currentTerminalState: "idle" | "active" | "throttled" = "idle";
  const runtimeState: RuntimeState = { lane: "new", session: "detached", terminal: "idle" };

  let harnessStatus: { status: "available" | "unavailable"; degrade_reason: string | null } = {
    status: "available",
    degrade_reason: null,
  };

  function getTerminalBufferInternal(terminalId: string): TerminalBuffer {
    let buffer = terminalBuffers.get(terminalId);
    if (!buffer) {
      buffer = {
        terminal_id: terminalId,
        total_bytes: 0,
        dropped_bytes: 0,
        entries: [],
      };
      terminalBuffers.set(terminalId, buffer);
    }
    return buffer;
  }

  function getTerminalState(): "idle" | "active" | "throttled" {
    return currentTerminalState;
  }

  function setTerminalState(state: "idle" | "active" | "throttled"): void {
    currentTerminalState = state;
    runtimeState.terminal = state;
  }

  const opsContext = {
    bus,
    terminalRegistry,
    terminalBufferCap,
    terminalBuffers,
    appendAuditRecord,
    getTerminalBuffer: getTerminalBufferInternal,
    getTerminalState,
    setTerminalState,
    getRuntimeState,
    recovery,
    redactionEngine,
    rawBusRequest: innerBus.request.bind(innerBus),
  };

  async function request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    recordCommand(command);
    const response = await handleRuntimeRequest(opsContext as any, command);
    recordResponse(response);

    if (command.method === "session.attach" && response.status === "ok") {
      runtimeState.session = "attached";
    }

    if (command.method === "lane.create" && response.status === "ok") {
      runtimeState.lane = "running";
    }

    if (command.method === "terminal.spawn" && response.status === "ok") {
      console.log(
        "createRuntime.request: terminal.spawn detected, clearing buffer",
        command.terminal_id,
        response.result?.terminal_id
      );
      runtimeState.terminal = "active";
      const terminalId = String(response.result?.terminal_id ?? "");
      if (terminalId) {
        console.log("createRuntime.request: deleting buffer for", terminalId);
        terminalBuffers.delete(terminalId);
        terminalRegistry.spawn({
          terminal_id: terminalId,
          workspace_id: command.workspace_id ?? "",
          lane_id: command.lane_id ?? "",
          session_id: command.session_id ?? "",
          title:
            typeof command.payload?.title === "string" ? String(command.payload.title) : "Terminal",
        });
        terminalRegistry.setState(terminalId, "active");
      }
    }

    if (command.method === "terminal.resize" && response.status === "ok") {
      runtimeState.terminal = "active";
      const terminalId =
        command.terminal_id ?? (command.payload as Record<string, unknown>)?.terminal_id;
      if (typeof terminalId === "string") {
        terminalRegistry.setState(terminalId, "active");
      }
      // Apply recovery bookkeeping for terminal state changes
      applyRecoveryFromCommand(command, response);
    }

    if (command.method === "terminal.input" && response.status === "ok") {
      runtimeState.terminal = getTerminalState();
      const terminalId =
        command.terminal_id ?? (command.payload as Record<string, unknown>)?.terminal_id;
      if (typeof terminalId === "string") {
        terminalRegistry.setState(
          terminalId,
          runtimeState.terminal === "throttled" ? "throttled" : "active"
        );
      }
      // Apply recovery bookkeeping for terminal state changes
      applyRecoveryFromCommand(command, response);
    }

    return response;
  }

  function getEvents(): LocalBusEnvelope[] {
    return bus.getEvents();
  }

  function getState(): RuntimeState {
    return { ...runtimeState };
  }

  function getRuntimeState(): RuntimeState {
    return { ...runtimeState };
  }

  function getTerminal(terminalId: string) {
    return terminalRegistry.get(terminalId);
  }

  function getTerminalBuffer(terminalId: string): TerminalBuffer {
    return getTerminalBufferInternal(terminalId);
  }

  async function spawnTerminal(input: {
    command_id: string;
    correlation_id: string;
    workspace_id: string;
    lane_id: string;
    session_id: string;
    title?: string;
    terminal_id?: string;
  }): Promise<LocalBusEnvelope> {
    const command: LocalBusEnvelope = {
      id: input.command_id,
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: input.workspace_id,
      lane_id: input.lane_id,
      session_id: input.session_id,
      correlation_id: input.correlation_id,
      method: "terminal.spawn",
      payload: {
        ...(input.terminal_id ? { terminal_id: input.terminal_id } : {}),
        session_id: input.session_id,
        title: input.title,
      },
    };
    return request(command);
  }

  async function inputTerminal(input: {
    command_id: string;
    correlation_id: string;
    workspace_id: string;
    lane_id: string;
    session_id: string;
    terminal_id: string;
    data: string;
  }): Promise<LocalBusEnvelope> {
    const command: LocalBusEnvelope = {
      id: input.command_id,
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: input.workspace_id,
      lane_id: input.lane_id,
      session_id: input.session_id,
      terminal_id: input.terminal_id,
      correlation_id: input.correlation_id,
      method: "terminal.input",
      payload: {
        terminal_id: input.terminal_id,
        data: input.data,
      },
    };
    return request(command);
  }

  async function resizeTerminal(input: {
    command_id: string;
    correlation_id: string;
    workspace_id: string;
    lane_id: string;
    session_id: string;
    terminal_id: string;
    cols: number;
    rows: number;
  }): Promise<LocalBusEnvelope> {
    const command: LocalBusEnvelope = {
      id: input.command_id,
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: input.workspace_id,
      lane_id: input.lane_id,
      session_id: input.session_id,
      terminal_id: input.terminal_id,
      correlation_id: input.correlation_id,
      method: "terminal.resize",
      payload: {
        terminal_id: input.terminal_id,
        cols: input.cols,
        rows: input.rows,
      },
    };
    return request(command);
  }

  async function fetch(requestInput: Request): Promise<Response> {
    const url = new URL(requestInput.url);

    if (url.pathname === "/v1/protocol/dispatch" && requestInput.method === "POST") {
      const body = (await requestInput.json()) as Record<string, unknown>;
      const command: LocalBusEnvelope = {
        id: `dispatch-${Date.now()}`,
        type: "command",
        ts: new Date().toISOString(),
        workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : undefined,
        correlation_id: typeof body.correlation_id === "string" ? body.correlation_id : undefined,
        method: String(body.method ?? ""),
        payload: normalizePayload(body.payload),
      };

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal: request,
      });
      const result = await dispatcher(command);
      if (result.type !== "response") {
        return Response.json({ error: "invalid_boundary_response" }, { status: 500 });
      }

      if (result.status === "error") {
        const status = result.error?.code === "UNSUPPORTED_BOUNDARY_ADAPTER" ? 409 : 400;
        return Response.json(
          {
            error: result.error?.code ?? "dispatch_error",
            details: result.error?.details ?? null,
          },
          { status }
        );
      }

      return Response.json(result.result ?? {}, { status: 200 });
    }
    if (url.pathname.match(/\/v1\/workspaces\/[^^/]+\/lanes$/) && requestInput.method === "POST") {
      const body = (await requestInput.json()) as Record<string, any>;
      const workspaceId = url.pathname.split("/")[3];

      const lane = await laneService.create({
        workspace_id: workspaceId,
        project_context_id: String(body.project_context_id ?? "default"),
        display_name: String(body.display_name ?? "Lane"),
      });

      runtimeState.lane = lane.status;
      return Response.json({ lane_id: lane.lane_id }, { status: 201 });
    }

    if (
      url.pathname.match(/\/v1\/workspaces\/[^^/]+\/lanes\/[^^/]+\/sessions$/) &&
      requestInput.method === "POST"
    ) {
      const body = (await requestInput.json()) as Record<string, any>;
      const laneId = url.pathname.split("/")[5];
      const workspaceId = url.pathname.split("/")[3];

      if (
        body.preferred_transport &&
        body.preferred_transport !== "native_openai" &&
        body.preferred_transport !== "cliproxy_harness"
      ) {
        return Response.json({ error: "invalid_preferred_transport" }, { status: 400 });
      }

      let probeResult: { ok: boolean; reason: string | null };
      try {
        const result = options.harnessProbe
          ? await options.harnessProbe.check()
          : { ok: true, reason: null };
        probeResult = { ok: result.ok, reason: result.reason ?? null };
      } catch (err) {
        console.error("[Runtime] Harness probe exception:", err);
        probeResult = { ok: false, reason: "harness_probe_exception" };
      }

      let transport: "cliproxy_harness" | "native_openai";
      let degrade_reason: string | null = null;

      if (body.provider === "codex") {
        if (probeResult.ok) {
          transport = "cliproxy_harness";
          degrade_reason = null;
        } else {
          transport = "native_openai";
          degrade_reason = probeResult.reason || "harness_unavailable";
          if (
            harnessStatus.status !== "unavailable" ||
            harnessStatus.degrade_reason !== degrade_reason
          ) {
            harnessStatus = { status: "unavailable", degrade_reason };
            const statusEvt = {
              id: `evt-harness-status-changed-${Date.now()}`,
              type: "event",
              ts: new Date().toISOString(),
              topic: "harness.status.changed",
              payload: {
                status: "unavailable",
                degrade_reason,
              },
            };
            await bus.publish(statusEvt as LocalBusEnvelope);
            appendAuditRecord({ ...statusEvt, recorded_at: statusEvt.ts, type: "event" } as any);
          }
        }
      } else {
        transport = "native_openai";
      }

      if (probeResult.ok && harnessStatus.status !== "available") {
        harnessStatus = { status: "available", degrade_reason: null };
        const statusEvt = {
          id: `evt-harness-status-changed-${Date.now()}`,
          type: "event",
          ts: new Date().toISOString(),
          topic: "harness.status.changed",
          payload: {
            status: "available",
            degrade_reason: null,
          },
        };
        await bus.publish(statusEvt as LocalBusEnvelope);
        appendAuditRecord({ ...statusEvt, recorded_at: statusEvt.ts, type: "event" } as any);
      }

      const ensureSession = sessionRegistry.ensure({
        lane_id: laneId,
        transport,
        codex_session_id:
          typeof body.codex_session_id === "string" ? body.codex_session_id : undefined,
      });

      runtimeState.session = "attached";

      const startEvt = {
        id: `evt-session-attach-started-${Date.now()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "session.attach.started",
        session_id: ensureSession.session.session_id,
        lane_id: laneId,
        workspace_id: workspaceId,
        correlation_id: body.correlation_id || `corr-${Date.now()}`,
        payload: { session_id: ensureSession.session.session_id },
      };
      await bus.publish(startEvt as LocalBusEnvelope);
      appendAuditRecord({ ...startEvt, recorded_at: startEvt.ts, type: "event" } as any);

      const attachedEvt = {
        id: `evt-session-attached-${Date.now()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "session.attached",
        session_id: ensureSession.session.session_id,
        lane_id: laneId,
        workspace_id: workspaceId,
        correlation_id: startEvt.correlation_id,
        payload: { session_id: ensureSession.session.session_id },
      };
      await bus.publish(attachedEvt as LocalBusEnvelope);
      appendAuditRecord({ ...attachedEvt, recorded_at: attachedEvt.ts, type: "event" } as any);

      const createdEvt = {
        id: `evt-session-created-${Date.now()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "session.created",
        session_id: ensureSession.session.session_id,
        lane_id: laneId,
        workspace_id: workspaceId,
        correlation_id: startEvt.correlation_id,
        payload: { session_id: ensureSession.session.session_id },
      };
      await bus.publish(createdEvt as LocalBusEnvelope);
      appendAuditRecord({ ...createdEvt, recorded_at: createdEvt.ts, type: "event" } as any);

      return Response.json(
        {
          session_id: ensureSession.session.session_id,
          transport,
          status: "attached",
          diagnostics: { degrade_reason },
          codex_session_id: ensureSession.session.codex_session_id,
        },
        { status: 200 }
      );
    }

    if (
      url.pathname.match(/\/v1\/workspaces\/[^^/]+\/lanes\/[^^/]+\/terminals$/) &&
      requestInput.method === "POST"
    ) {
      const body = (await requestInput.json()) as Record<string, any>;
      const laneId = url.pathname.split("/")[5];
      const workspaceId = url.pathname.split("/")[3];

      let lane: LaneRecord;
      try {
        lane = laneService.getRequired(laneId);
      } catch {
        return Response.json({ error: "lane_not_found" }, { status: 404 });
      }

      if (lane.workspace_id !== workspaceId) {
        return Response.json({ error: "does not belong to workspace" }, { status: 409 });
      }

      if (lane.status === "closed") {
        return Response.json({ error: "lane_closed" }, { status: 409 });
      }

      const spawnResult = await spawnTerminal({
        command_id: `cmd-spawn-${Date.now()}`,
        correlation_id: body.correlation_id || `corr-${Date.now()}`,
        workspace_id: workspaceId,
        lane_id: laneId,
        session_id: body.session_id,
        title: typeof body.title === "string" ? body.title : "Terminal",
      });

      if (spawnResult.status !== "ok") {
        return Response.json(
          { error: spawnResult.error?.code ?? "terminal.spawn.failed" },
          { status: 500 }
        );
      }

      return Response.json(
        {
          terminal_id: String(spawnResult.result?.terminal_id),
          lane_id: laneId,
          session_id: body.session_id,
          state: "active",
        },
        { status: 201 }
      );
    }

    if (
      url.pathname.match(/\/v1\/workspaces\/[^^/]+\/lanes\/[^^/]+\/cleanup$/) &&
      requestInput.method === "POST"
    ) {
      const laneId = url.pathname.split("/")[5];
      await laneService.cleanup(url.pathname.split("/")[3], laneId);
      runtimeState.lane = "closed";
      return Response.json({ status: "ok" }, { status: 200 });
    }

    if (url.pathname === "/v1/harness/cliproxy/status" && requestInput.method === "GET") {
      return Response.json(
        {
          status: harnessStatus.status === "available" ? "available" : "unavailable",
          degrade_reason: harnessStatus.degrade_reason,
        },
        { status: 200 }
      );
    }

    return new Response("Not found", { status: 404 });
  }
  function exportAuditBundle(filter?: { correlation_id?: string }): RuntimeAuditBundle {
    const records = filter?.correlation_id
      ? auditRecords.filter(record => record.correlation_id === filter.correlation_id)
      : [...auditRecords];
    return {
      count: records.length,
      records,
      exported_at: new Date().toISOString(),
    };
  }

  return {
    bus,
    fetch,
    exportRecoveryMetadata(): RecoveryMetadata {
      return recovery.snapshot();
    },
    getBootstrapResult(): RecoveryBootstrapResult | null {
      return bootstrapResult;
    },
    bootstrapRecovery(metadata: RecoveryMetadata): RecoveryBootstrapResult {
      bootstrapResult = recovery.bootstrap(metadata);
      return bootstrapResult;
    },
    getOrphanReport(): WatchdogScanResult {
      return recovery.scanForOrphans(new Date().toISOString());
    },
    exportAuditBundle,
    async getAuditRecords(): Promise<RuntimeAuditRecord[]> {
      return [...auditRecords];
    },
    getEvents,
    getState,
    getTerminal,
    getTerminalBuffer,
    spawnTerminal,
    inputTerminal,
    resizeTerminal,
    shutdown(): void {},
  };
}

export type { RuntimeInstance };
