/**
 * FR-HELIOS-090: Session Harness Routing Tests
 * Verifies: FR-PVD-003 (ACP for Claude/agent task execution)
 */
import { describe, expect, it } from "bun:test";
import { createRuntime } from "../../../src/index";

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createLane(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  const response = await runtime.fetch(
    jsonRequest("http://localhost/v1/workspaces/ws_1/lanes", {
      project_context_id: "project_1",
      display_name: "WP02 lane",
    })
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { lane_id: string };
  return body.lane_id;
}

async function ensureSession(
  runtime: ReturnType<typeof createRuntime>,
  laneId: string,
  body: Record<string, unknown> = { provider: "codex" }
): Promise<Response> {
  return runtime.fetch(
    jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/sessions`, body)
  );
}

describe("session routing lifecycle", () => {
  it("uses cliproxy_harness when health check is healthy", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const response = await ensureSession(runtime, laneId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      transport: string;
      status: string;
      diagnostics: { degrade_reason: string | null };
    };

    expect(body.transport).toBe("cliproxy_harness");
    expect(body.status).toBe("attached");
    expect(body.diagnostics.degrade_reason).toBeNull();

    const events = runtime.getEvents();
    expect(events.some(event => event.topic === "lane.created")).toBeTrue();
    expect(events.some(event => event.topic === "session.created")).toBeTrue();
  });

  it("falls back to native_openai with explicit degrade reason when harness is unavailable", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: false, reason: "cliproxy_timeout" };
        },
      },
    });

    const laneId = await createLane(runtime);
    const response = await ensureSession(runtime, laneId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      transport: string;
      diagnostics: { degrade_reason: string | null };
    };

    expect(body.transport).toBe("native_openai");
    expect(body.diagnostics.degrade_reason).toBe("cliproxy_timeout");

    const statusResponse = await runtime.fetch(
      new Request("http://localhost/v1/harness/cliproxy/status")
    );
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      status: string;
      degrade_reason: string | null;
    };

    expect(statusBody.status).toBe("unavailable");
    expect(statusBody.degrade_reason).toBe("cliproxy_timeout");

    const events = runtime.getEvents();
    expect(events.some(event => event.topic === "harness.status.changed")).toBeTrue();
  });

  it("remains usable when harness becomes unavailable mid-flow", async () => {
    let healthy = true;
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          if (healthy) {
            return { ok: true };
          }
          return { ok: false, reason: "cliproxy_crash" };
        },
      },
    });

    const laneOne = await createLane(runtime);
    const firstResponse = await ensureSession(runtime, laneOne);

    expect(firstResponse.status).toBe(200);
    const firstBody = (await firstResponse.json()) as { transport: string };
    expect(firstBody.transport).toBe("cliproxy_harness");

    healthy = false;
    const laneTwo = await createLane(runtime);
    const secondResponse = await ensureSession(runtime, laneTwo);

    expect(secondResponse.status).toBe(200);
    const secondBody = (await secondResponse.json()) as {
      transport: string;
      diagnostics: { degrade_reason: string | null };
    };

    expect(secondBody.transport).toBe("native_openai");
    expect(secondBody.diagnostics.degrade_reason).toBe("cliproxy_crash");
  });

  it("keeps ensureSession idempotent on repeated calls for the same lane", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const firstResponse = await ensureSession(runtime, laneId, {
      provider: "codex",
      codex_session_id: "codex_existing",
    });
    expect(firstResponse.status).toBe(200);
    const firstBody = (await firstResponse.json()) as {
      session_id: string;
      codex_session_id: string;
    };

    const secondResponse = await ensureSession(runtime, laneId, {
      provider: "codex",
      codex_session_id: "codex_existing",
    });
    expect(secondResponse.status).toBe(200);
    const secondBody = (await secondResponse.json()) as {
      session_id: string;
      codex_session_id: string;
    };

    expect(secondBody.session_id).toBe(firstBody.session_id);
    expect(secondBody.codex_session_id).toBe("codex_existing");
  });

  it("rejects invalid preferred_transport values", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const response = await ensureSession(runtime, laneId, {
      provider: "codex",
      preferred_transport: "not_allowed",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_preferred_transport");
  });

  it("implements terminal spawn endpoint with protocol lifecycle events", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
        title: "Main",
      })
    );

    expect(terminalResponse.status).toBe(201);
    const terminalBody = (await terminalResponse.json()) as {
      terminal_id: string;
      lane_id: string;
      session_id: string;
      state: string;
    };

    expect(terminalBody.terminal_id.startsWith("term_")).toBeTrue();
    expect(terminalBody.lane_id).toBe(laneId);
    expect(terminalBody.session_id).toBe(sessionBody.session_id);
    expect(terminalBody.state).toBe("active");

    const events = runtime.getEvents();
    expect(events.some(event => event.topic === "terminal.spawn.started")).toBeTrue();
    expect(events.some(event => event.topic === "terminal.state.changed")).toBeTrue();
    expect(events.some(event => event.topic === "terminal.spawned")).toBeTrue();
    expect(runtime.getTerminal(terminalBody.terminal_id)?.state).toBe("active");
  });

  it("rejects terminal spawn when lane workspace does not match route workspace", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_2/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
        title: "Spoofed",
      })
    );

    expect(terminalResponse.status).toBe(409);
    const body = (await terminalResponse.json()) as { error: string };
    expect(body.error).toContain("does not belong to workspace");
  });

  it("updates runtime state when HTTP lifecycle endpoints drive session and terminal transitions", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
      })
    );
    expect(terminalResponse.status).toBe(201);

    const runtimeState = runtime.getState();
    expect(runtimeState.session).toBe("attached");
    expect(runtimeState.terminal).toBe("active");
  });

  it("rejects terminal spawn when lane is closed", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const cleanupResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/cleanup`, {})
    );
    expect(cleanupResponse.status).toBe(200);

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
        title: "Closed Lane Terminal",
      })
    );
    expect(terminalResponse.status).toBe(409);
    const body = (await terminalResponse.json()) as { error: string };
    expect(body.error).toBe("lane_closed");
  });

  it("updates runtime state when HTTP lifecycle endpoints drive session and terminal transitions", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
      })
    );
    expect(terminalResponse.status).toBe(201);

    const runtimeState = runtime.getState();
    expect(runtimeState.session).toBe("attached");
    expect(runtimeState.terminal).toBe("active");
  });

  it("rejects terminal spawn when lane is closed", async () => {
    const runtime = createRuntime({
      harnessProbe: {
        async check() {
          return { ok: true };
        },
      },
    });

    const laneId = await createLane(runtime);
    const sessionResponse = await ensureSession(runtime, laneId);
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session_id: string;
    };

    const cleanupResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/cleanup`, {})
    );
    expect(cleanupResponse.status).toBe(200);

    const terminalResponse = await runtime.fetch(
      jsonRequest(`http://localhost/v1/workspaces/ws_1/lanes/${laneId}/terminals`, {
        session_id: sessionBody.session_id,
        title: "Closed Lane Terminal",
      })
    );
    expect(terminalResponse.status).toBe(409);
    const body = (await terminalResponse.json()) as { error: string };
    expect(body.error).toBe("lane_closed");
  });
});
