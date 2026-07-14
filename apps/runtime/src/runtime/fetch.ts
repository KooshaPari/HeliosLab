import { createBoundaryDispatcher } from "../protocol/boundary_adapter.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import type { InMemoryLocalBus } from "../protocol/bus.js";
import type { RuntimeAuditRecord } from "./types.js";

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export async function handleRuntimeFetch(
  requestInput: Request,
  request: (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>,
  context: { bus: InMemoryLocalBus; appendAuditRecord(record: RuntimeAuditRecord): void }
): Promise<Response> {
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

    const dispatcher = createBoundaryDispatcher({ dispatchLocal: request });
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

  if (url.pathname.match(/\/v1\/workspaces\/[^/]+\/lanes$/) && requestInput.method === "POST") {
    const body = (await requestInput.json()) as Record<string, any>;
    const laneId = `lane_${Date.now()}`;
    const workspaceId = url.pathname.split("/")[3];

    const startEvt = {
      id: `evt-lane-create-started-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "lane.create.started",
      lane_id: laneId,
      workspace_id: workspaceId,
      correlation_id: body.correlation_id || `corr-${Date.now()}`,
      payload: { lane_id: laneId, workspace_id: body.workspace_id || workspaceId },
    };
    await context.bus.publish(startEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...startEvt, recorded_at: startEvt.ts, type: "event" } as any);

    const createdEvt = {
      id: `evt-lane-created-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "lane.created",
      lane_id: laneId,
      workspace_id: workspaceId,
      correlation_id: startEvt.correlation_id,
      payload: { lane_id: laneId, workspace_id: body.workspace_id || workspaceId },
    };
    await context.bus.publish(createdEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...createdEvt, recorded_at: createdEvt.ts, type: "event" } as any);

    return Response.json({ lane_id: laneId }, { status: 201 });
  }

  if (
    url.pathname.match(/\/v1\/workspaces\/[^/]+\/lanes\/[^/]+\/sessions$/) &&
    requestInput.method === "POST"
  ) {
    const body = (await requestInput.json()) as Record<string, any>;
    const sessionId = `sess_${Date.now()}`;
    const laneId = url.pathname.split("/")[5];
    const workspaceId = url.pathname.split("/")[3];

    if (
      body.preferred_transport &&
      body.preferred_transport !== "native_openai" &&
      body.preferred_transport !== "cliproxy_harness"
    ) {
      return Response.json({ error: "invalid_preferred_transport" }, { status: 400 });
    }

    const startEvt = {
      id: `evt-session-attach-started-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "session.attach.started",
      session_id: sessionId,
      lane_id: laneId,
      workspace_id: workspaceId,
      correlation_id: body.correlation_id || `corr-${Date.now()}`,
      payload: { session_id: sessionId },
    };
    await context.bus.publish(startEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...startEvt, recorded_at: startEvt.ts, type: "event" } as any);

    const attachedEvt = {
      id: `evt-session-attached-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "session.attached",
      session_id: sessionId,
      lane_id: laneId,
      workspace_id: workspaceId,
      correlation_id: startEvt.correlation_id,
      payload: { session_id: sessionId },
    };
    await context.bus.publish(attachedEvt as LocalBusEnvelope);
    context.appendAuditRecord({
      ...attachedEvt,
      recorded_at: attachedEvt.ts,
      type: "event",
    } as any);

    const createdEvt = {
      id: `evt-session-created-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "session.created",
      session_id: sessionId,
      lane_id: laneId,
      workspace_id: workspaceId,
      correlation_id: startEvt.correlation_id,
      payload: { session_id: sessionId },
    };
    await context.bus.publish(createdEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...createdEvt, recorded_at: createdEvt.ts, type: "event" } as any);

    return Response.json(
      {
        session_id: sessionId,
        transport: body.provider === "codex" ? "native_openai" : "cliproxy_harness",
        status: "attached",
        diagnostics: { degrade_reason: null },
        codex_session_id: body.codex_session_id,
      },
      { status: 200 }
    );
  }

  if (
    url.pathname.match(/\/v1\/workspaces\/[^/]+\/lanes\/[^/]+\/terminals$/) &&
    requestInput.method === "POST"
  ) {
    const body = (await requestInput.json()) as Record<string, any>;
    const terminalId = `term_${Date.now()}`;
    const laneId = url.pathname.split("/")[5];

    const startEvt = {
      id: `evt-terminal-spawn-started-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.spawn.started",
      terminal_id: terminalId,
      correlation_id: body.correlation_id,
      payload: { terminal_id: terminalId },
    };
    await context.bus.publish(startEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...startEvt, recorded_at: startEvt.ts, type: "event" } as any);

    const spawnedEvt = {
      id: `evt-terminal-spawned-${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "terminal.spawned",
      terminal_id: terminalId,
      correlation_id: body.correlation_id,
      payload: { terminal_id: terminalId },
    };
    await context.bus.publish(spawnedEvt as LocalBusEnvelope);
    context.appendAuditRecord({ ...spawnedEvt, recorded_at: spawnedEvt.ts, type: "event" } as any);

    return Response.json(
      {
        terminal_id: terminalId,
        lane_id: laneId,
        session_id: body.session_id,
        state: "active",
      },
      { status: 201 }
    );
  }

  if (
    url.pathname.match(/\/v1\/workspaces\/[^/]+\/lanes\/[^/]+\/cleanup$/) &&
    requestInput.method === "POST"
  ) {
    return Response.json({ status: "ok" }, { status: 200 });
  }

  return new Response("Not found", { status: 404 });
}
