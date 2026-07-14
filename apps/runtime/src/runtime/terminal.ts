import { METHODS } from "../protocol/methods.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import type { InMemoryLocalBus } from "../protocol/bus.js";
import { TerminalRegistry } from "../sessions/terminal_registry.js";
import type { RuntimeAuditRecord, TerminalBuffer } from "./types.js";

export type RuntimeTerminalContext = {
  bus: InMemoryLocalBus;
  terminalRegistry: TerminalRegistry;
  terminalBufferCap: number;
  terminalBuffers: Map<string, TerminalBuffer>;
  appendAuditRecord(record: RuntimeAuditRecord): void;
  getTerminalBuffer(terminalId: string): TerminalBuffer;
  getTerminalState(): "active" | "throttled" | "idle";
  setTerminalState(state: "active" | "throttled" | "idle"): void;
  getRuntimeState(): { lane: string; session: string; terminal: "active" | "throttled" | "idle" };
};

const _METHOD_SET = new Set<string>(METHODS);

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function recordResponse(context: RuntimeTerminalContext, envelope: LocalBusEnvelope): void {
  context.appendAuditRecord({
    recorded_at: new Date().toISOString(),
    type: "response",
    method: envelope.method,
    correlation_id: envelope.correlation_id,
    payload: normalizePayload(envelope.result ?? envelope.payload),
    error: envelope.error ?? null,
  });
}

function appendTerminalOutput(
  context: RuntimeTerminalContext,
  terminalId: string,
  data: string,
  correlationId?: string,
  workspaceId?: string,
  laneId?: string,
  sessionId?: string
): void {
  const buffer = context.getTerminalBuffer(terminalId);
  const dataSize = data.length;
  const workspace_id = workspaceId ?? context.terminalRegistry.get(terminalId)?.workspace_id ?? "";
  const lane_id = laneId ?? context.terminalRegistry.get(terminalId)?.lane_id ?? "";
  const session_id = sessionId ?? context.terminalRegistry.get(terminalId)?.session_id ?? "";

  if (buffer.total_bytes + dataSize > context.terminalBufferCap) {
    buffer.dropped_bytes += dataSize;
    context.setTerminalState("throttled");
    const stateEvt: LocalBusEnvelope = {
      id: `evt-throttle-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.state.changed",
      correlation_id: correlationId,
      workspace_id,
      lane_id,
      session_id,
      terminal_id: terminalId,
      payload: { state: "throttled", runtime_state: context.getRuntimeState() },
    };
    context.bus.publish(stateEvt);
    context.appendAuditRecord({ ...stateEvt, recorded_at: stateEvt.ts, type: "event" } as any);

    const overflowEvt: LocalBusEnvelope = {
      id: `evt-output-overflow-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.output",
      correlation_id: correlationId,
      workspace_id,
      lane_id,
      session_id,
      terminal_id: terminalId,
      payload: { overflowed: true },
    };
    context.bus.publish(overflowEvt);
    context.appendAuditRecord({
      ...overflowEvt,
      recorded_at: overflowEvt.ts,
      type: "event",
    } as any);
    return;
  }

  const seq = buffer.entries.length + 1;
  buffer.entries.push({ seq, data });
  buffer.total_bytes += dataSize;

  const outputEvt: LocalBusEnvelope = {
    id: `evt-output-${Date.now()}`,
    type: "event",
    ts: new Date().toISOString(),
    topic: "terminal.output",
    correlation_id: correlationId,
    workspace_id,
    lane_id,
    session_id,
    terminal_id: terminalId,
    payload: { seq, data_length: dataSize, runtime_state: context.getRuntimeState() },
  };

  context.bus.publish(outputEvt);
  context.appendAuditRecord({
    recorded_at: new Date().toISOString(),
    type: "event",
    topic: "terminal.output",
    correlation_id: correlationId,
    payload: { terminal_id: terminalId, seq, data_length: dataSize },
  });
}

export async function handleTerminalCommand(
  context: RuntimeTerminalContext,
  command: LocalBusEnvelope
): Promise<LocalBusEnvelope | undefined> {
  if (command.type !== "command" || !command.method) {
    return undefined;
  }

  if (command.method === "terminal.spawn") {
    const payload = normalizePayload(command.payload);
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
    const terminalId =
      typeof payload.terminal_id === "string"
        ? payload.terminal_id
        : sessionId
          ? `term_${sessionId}_${Date.now()}`
          : `term_${Date.now()}`;
    const finalTerminalId = terminalId;

    // Ensure terminal buffer is cleared when reusing an existing terminal id.
    const terminalBuffer = context.getTerminalBuffer(finalTerminalId);
    terminalBuffer.entries = [];
    terminalBuffer.total_bytes = 0;
    terminalBuffer.dropped_bytes = 0;

    // Ensure registry reflects the newly spawned terminal context.
    context.terminalRegistry.spawn({
      terminal_id: finalTerminalId,
      workspace_id: command.workspace_id ?? "",
      lane_id: command.lane_id ?? "",
      session_id: command.session_id ?? "",
      title: typeof payload.title === "string" ? String(payload.title) : "Terminal",
    });
    context.terminalRegistry.setState(finalTerminalId, "active");

    context.setTerminalState("active");

    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "ok",
      result: { terminal_id: finalTerminalId },
    };

    const spawnStartedEvt = {
      id: `evt-spawn-started-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.spawn.started",
      correlation_id: command.correlation_id,
      workspace_id: command.workspace_id,
      lane_id: command.lane_id,
      session_id: command.session_id,
      terminal_id: finalTerminalId,
      payload: { terminal_id: finalTerminalId },
    };
    context.bus.publish(spawnStartedEvt as LocalBusEnvelope);
    context.appendAuditRecord({
      ...spawnStartedEvt,
      recorded_at: spawnStartedEvt.ts,
      type: "event",
    } as any);

    const stateInitEvt = {
      id: `evt-state-changed-1-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.state.changed",
      correlation_id: command.correlation_id,
      workspace_id: command.workspace_id,
      lane_id: command.lane_id,
      session_id: command.session_id,
      terminal_id: finalTerminalId,
      payload: { state: "initializing", runtime_state: context.getRuntimeState() },
    };
    context.bus.publish(stateInitEvt as LocalBusEnvelope);
    context.appendAuditRecord({
      ...stateInitEvt,
      recorded_at: stateInitEvt.ts,
      type: "event",
    } as any);

    const stateActiveEvt = {
      id: `evt-state-changed-2-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.state.changed",
      correlation_id: command.correlation_id,
      workspace_id: command.workspace_id,
      lane_id: command.lane_id,
      session_id: command.session_id,
      terminal_id: finalTerminalId,
      payload: { state: "active", runtime_state: context.getRuntimeState() },
    };
    context.bus.publish(stateActiveEvt as LocalBusEnvelope);
    context.appendAuditRecord({
      ...stateActiveEvt,
      recorded_at: stateActiveEvt.ts,
      type: "event",
    } as any);

    const spawnedEvt: LocalBusEnvelope = {
      id: `evt-spawned-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.spawned",
      correlation_id: command.correlation_id,
      workspace_id: command.workspace_id,
      lane_id: command.lane_id,
      session_id: command.session_id,
      terminal_id: finalTerminalId,
      payload: { terminal_id: finalTerminalId },
    };

    context.bus.publish(spawnedEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...spawnedEvt, recorded_at: spawnedEvt.ts, type: "event" } as any);

    return response;
  }

  if (command.method === "terminal.input") {
    const payload = normalizePayload(command.payload);
    const terminalId =
      typeof command.terminal_id === "string"
        ? command.terminal_id
        : typeof payload.terminal_id === "string"
          ? payload.terminal_id
          : undefined;
    const data = typeof payload.data === "string" ? payload.data : undefined;

    if (!terminalId) {
      const response: LocalBusEnvelope = {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        correlation_id: command.correlation_id,
        method: command.method,
        status: "error",
        error: {
          code: "MISSING_TERMINAL_ID",
          message: "Terminal ID is required",
          retryable: false,
        },
      };
      recordResponse(context, response);
      return response;
    }

    if (!data) {
      const response: LocalBusEnvelope = {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        correlation_id: command.correlation_id,
        method: command.method,
        status: "error",
        error: {
          code: "INVALID_TERMINAL_INPUT",
          message: "Payload 'data' is required",
          retryable: false,
        },
      };
      recordResponse(context, response);
      return response;
    }

    const buffer = context.getTerminalBuffer(terminalId);
    const seq = buffer.entries.length + 1;

    const terminal = context.terminalRegistry.get(terminalId);
    if (
      terminal &&
      !context.terminalRegistry.isOwnedBy(terminalId, {
        workspace_id: command.workspace_id ?? "",
        lane_id: command.lane_id ?? "",
        session_id: command.session_id ?? "",
      })
    ) {
      const response: LocalBusEnvelope = {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        correlation_id: command.correlation_id,
        method: command.method,
        status: "error",
        error: {
          code: "TERMINAL_CONTEXT_MISMATCH",
          message: "Cross-lane access denied",
          retryable: false,
        },
      };
      recordResponse(context, response);
      return response;
    }

    appendTerminalOutput(context, terminalId, data, command.correlation_id);

    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "ok",
      result: { output_seq: seq },
    };
    recordResponse(context, response);
    return response;
  }

  if (command.method === "terminal.resize") {
    const payload = normalizePayload(command.payload);
    const terminalId =
      typeof command.terminal_id === "string"
        ? command.terminal_id
        : typeof payload.terminal_id === "string"
          ? payload.terminal_id
          : undefined;

    // Validate terminal exists in registry before creating buffers or emitting events
    if (!terminalId) {
      const response: LocalBusEnvelope = {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        correlation_id: command.correlation_id,
        method: command.method,
        status: "error",
        error: {
          code: "MISSING_TERMINAL_ID",
          message: "Terminal ID is required",
          retryable: false,
        },
      };
      recordResponse(context, response);
      return response;
    }

    const terminal = context.terminalRegistry.get(terminalId);
    if (!terminal) {
      const response: LocalBusEnvelope = {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        correlation_id: command.correlation_id,
        method: command.method,
        status: "error",
        error: {
          code: "TERMINAL_NOT_FOUND",
          message: "Terminal not found in registry",
          retryable: false,
        },
      };
      recordResponse(context, response);
      return response;
    }

    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "ok",
    };

    context.setTerminalState("active");

    const stateActiveEvt = {
      id: `evt-state-changed-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.state.changed",
      correlation_id: command.correlation_id,
      workspace_id: command.workspace_id,
      lane_id: command.lane_id,
      session_id: command.session_id,
      terminal_id: terminalId,
      payload: { state: "active", runtime_state: context.getRuntimeState() },
    };
    context.bus.publish(stateActiveEvt as LocalBusEnvelope);
    context.appendAuditRecord({
      ...stateActiveEvt,
      recorded_at: stateActiveEvt.ts,
      type: "event",
    } as any);

    recordResponse(context, response);
    return response;
  }

  if (command.method && METHOD_SET.has(command.method)) {
    return undefined;
  }

  return undefined;
}
