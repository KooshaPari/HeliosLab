import { describe, it, expect, vi } from "vitest";
import type { LocalBusEnvelope, ResponseEnvelope } from "./types";
import {
  getBoundaryDispatchDecision,
  createBoundaryDispatcher,
} from "./boundary_adapter";

// Helper to create mock command envelopes
function createCommandEnvelope(
  method: string,
  overrides: Partial<LocalBusEnvelope> = {},
): LocalBusEnvelope {
  return {
    id: "test-id-123",
    type: "command",
    ts: new Date().toISOString(),
    workspace_id: "ws-123",
    lane_id: "lane-123",
    session_id: "session-123",
    terminal_id: "term-123",
    correlation_id: "corr-123",
    method,
    payload: {},
    ...overrides,
  };
}

// Helper to create mock response envelopes
function createResponseEnvelope(
  command: LocalBusEnvelope,
  status: "ok" | "error" = "ok",
  overrides: Partial<ResponseEnvelope> = {},
): ResponseEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    workspace_id: command.workspace_id,
    lane_id: command.lane_id,
    session_id: command.session_id,
    terminal_id: command.terminal_id,
    correlation_id: command.correlation_id,
    method: command.type === "command" ? command.method : undefined,
    status,
    result: status === "ok" ? { success: true } : undefined,
    error:
      status === "error"
        ? { code: "TEST_ERROR", message: "Test error", retryable: false }
        : undefined,
    ...overrides,
  };
}

describe(getBoundaryDispatchDecision, () => {
  describe("LOCAL_METHODS routing", () => {
    it("should route workspace.create to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("workspace.create");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route workspace.open to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("workspace.open");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route project.clone to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("project.clone");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route session.create to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("session.create");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route terminal.spawn to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("terminal.spawn");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route boundary.local.dispatch to local_control/local_bus", () => {
      const decision = getBoundaryDispatchDecision("boundary.local.dispatch");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should route all LOCAL_METHODS to local_control/local_bus", () => {
      const localMethods = [
        "workspace.create",
        "workspace.open",
        "project.clone",
        "project.init",
        "session.create",
        "session.attach",
        "session.terminate",
        "terminal.spawn",
        "terminal.resize",
        "terminal.input",
        "renderer.switch",
        "renderer.capabilities",
        "lane.create",
        "lane.attach",
        "lane.cleanup",
        "boundary.local.dispatch",
      ];

      localMethods.forEach((method) => {
        const decision = getBoundaryDispatchDecision(method);
        expect(decision).toEqual({
          boundary: "local_control",
          adapter: "local_bus",
        });
      });
    });
  });

  describe("TOOL_METHODS routing", () => {
    it("should route approval.request.resolve to tool_interop/tool_bridge", () => {
      const decision = getBoundaryDispatchDecision("approval.request.resolve");
      expect(decision).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
      });
    });

    it("should route share.upterm.start to tool_interop/tool_bridge", () => {
      const decision = getBoundaryDispatchDecision("share.upterm.start");
      expect(decision).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
      });
    });

    it("should route zmx.checkpoint to tool_interop/tool_bridge", () => {
      const decision = getBoundaryDispatchDecision("zmx.checkpoint");
      expect(decision).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
      });
    });

    it("should route boundary.tool.dispatch to tool_interop/tool_bridge", () => {
      const decision = getBoundaryDispatchDecision("boundary.tool.dispatch");
      expect(decision).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
      });
    });

    it("should route all TOOL_METHODS to tool_interop/tool_bridge", () => {
      const toolMethods = [
        "approval.request.resolve",
        "share.upterm.start",
        "share.upterm.stop",
        "share.tmate.start",
        "share.tmate.stop",
        "zmx.checkpoint",
        "zmx.restore",
        "boundary.tool.dispatch",
      ];

      toolMethods.forEach((method) => {
        const decision = getBoundaryDispatchDecision(method);
        expect(decision).toEqual({
          boundary: "tool_interop",
          adapter: "tool_bridge",
        });
      });
    });
  });

  describe("A2A_METHODS routing", () => {
    it("should route agent.run to agent_delegation/a2a_bridge", () => {
      const decision = getBoundaryDispatchDecision("agent.run");
      expect(decision).toEqual({
        boundary: "agent_delegation",
        adapter: "a2a_bridge",
      });
    });

    it("should route agent.cancel to agent_delegation/a2a_bridge", () => {
      const decision = getBoundaryDispatchDecision("agent.cancel");
      expect(decision).toEqual({
        boundary: "agent_delegation",
        adapter: "a2a_bridge",
      });
    });

    it("should route boundary.a2a.dispatch to agent_delegation/a2a_bridge", () => {
      const decision = getBoundaryDispatchDecision("boundary.a2a.dispatch");
      expect(decision).toEqual({
        boundary: "agent_delegation",
        adapter: "a2a_bridge",
      });
    });

    it("should route all A2A_METHODS to agent_delegation/a2a_bridge", () => {
      const a2aMethods = ["agent.run", "agent.cancel", "boundary.a2a.dispatch"];

      a2aMethods.forEach((method) => {
        const decision = getBoundaryDispatchDecision(method);
        expect(decision).toEqual({
          boundary: "agent_delegation",
          adapter: "a2a_bridge",
        });
      });
    });
  });

  describe("Unknown methods", () => {
    it("should default to local_control/local_bus for unknown methods", () => {
      const decision = getBoundaryDispatchDecision("unknown.method");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should default to local_control/local_bus for empty string", () => {
      const decision = getBoundaryDispatchDecision("");
      expect(decision).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should default to local_control/local_bus for arbitrary method names", () => {
      const unknownMethods = ["foo.bar", "baz.qux.quux", "custom.method"];

      unknownMethods.forEach((method) => {
        const decision = getBoundaryDispatchDecision(method);
        expect(decision).toEqual({
          boundary: "local_control",
          adapter: "local_bus",
        });
      });
    });
  });
});

describe(createBoundaryDispatcher, () => {
  describe("routing to correct dispatch function", () => {
    it("should route LOCAL_METHODS to dispatchLocal", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));
      const dispatchTool = vi.fn();
      const dispatchA2A = vi.fn();

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
        dispatchA2A,
      });

      const command = createCommandEnvelope("workspace.create");
      await dispatcher(command);

      expect(dispatchLocal).toHaveBeenCalledWith(command);
      expect(dispatchTool).not.toHaveBeenCalled();
      expect(dispatchA2A).not.toHaveBeenCalled();
    });

    it("should route TOOL_METHODS to dispatchTool", async () => {
      const dispatchLocal = vi.fn();
      const dispatchTool = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));
      const dispatchA2A = vi.fn();

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
        dispatchA2A,
      });

      const command = createCommandEnvelope("zmx.checkpoint");
      await dispatcher(command);

      expect(dispatchTool).toHaveBeenCalledWith(command);
      expect(dispatchLocal).not.toHaveBeenCalled();
      expect(dispatchA2A).not.toHaveBeenCalled();
    });

    it("should route A2A_METHODS to dispatchA2A", async () => {
      const dispatchLocal = vi.fn();
      const dispatchTool = vi.fn();
      const dispatchA2A = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
        dispatchA2A,
      });

      const command = createCommandEnvelope("agent.run");
      await dispatcher(command);

      expect(dispatchA2A).toHaveBeenCalledWith(command);
      expect(dispatchLocal).not.toHaveBeenCalled();
      expect(dispatchTool).not.toHaveBeenCalled();
    });

    it("should route unknown methods to dispatchLocal", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));
      const dispatchTool = vi.fn();
      const dispatchA2A = vi.fn();

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
        dispatchA2A,
      });

      const command = createCommandEnvelope("unknown.method");
      await dispatcher(command);

      expect(dispatchLocal).toHaveBeenCalledWith(command);
      expect(dispatchTool).not.toHaveBeenCalled();
      expect(dispatchA2A).not.toHaveBeenCalled();
    });
  });

  describe("missing dispatchTool", () => {
    it("should return UNSUPPORTED_BOUNDARY_ADAPTER error when dispatchTool is undefined", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        // DispatchTool intentionally omitted
      });

      const command = createCommandEnvelope("zmx.checkpoint");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNSUPPORTED_BOUNDARY_ADAPTER");
      expect(response.error?.message).toBe("tool_interop adapter unavailable");
      expect(response.error?.details).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
        method: "zmx.checkpoint",
      });
    });
  });

  describe("missing dispatchA2A", () => {
    it("should return UNSUPPORTED_BOUNDARY_ADAPTER error when dispatchA2A is undefined", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        // DispatchA2A intentionally omitted
      });

      const command = createCommandEnvelope("agent.run");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNSUPPORTED_BOUNDARY_ADAPTER");
      expect(response.error?.message).toBe("agent_delegation adapter unavailable");
      expect(response.error?.details).toEqual({
        boundary: "agent_delegation",
        adapter: "a2a_bridge",
        method: "agent.run",
      });
    });
  });

  describe("non-command envelope type", () => {
    it("should return INVALID_ENVELOPE_TYPE error for response envelope", async () => {
      const dispatchLocal = vi.fn();

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
      });

      const command = createCommandEnvelope("workspace.create");
      const responseEnvelope = createResponseEnvelope(command);
      responseEnvelope.type = "response";

      const response = (await dispatcher(responseEnvelope as LocalBusEnvelope)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_ENVELOPE_TYPE");
      expect(response.error?.message).toBe("command envelope required");
      expect(response.error?.details).toEqual({
        type: "response",
      });
    });

    it("should return INVALID_ENVELOPE_TYPE error for event envelope", async () => {
      const dispatchLocal = vi.fn();

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
      });

      const envelope: LocalBusEnvelope = {
        id: "test-id",
        type: "event",
        ts: new Date().toISOString(),
        topic: "test.topic",
      };

      const response = (await dispatcher(envelope)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_ENVELOPE_TYPE");
      expect(response.error?.message).toBe("command envelope required");
      expect(response.error?.details).toEqual({
        type: "event",
      });
    });
  });

  describe("non-response from adapter", () => {
    it("should return INVALID_BOUNDARY_RESPONSE error when adapter returns command", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => {
        // Returns command instead of response
        return cmd;
      });

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
      });

      const command = createCommandEnvelope("workspace.create");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_BOUNDARY_RESPONSE");
      expect(response.error?.message).toBe("boundary adapter must return response");
      expect(response.error?.details).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should return INVALID_BOUNDARY_RESPONSE error when adapter returns event", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => {
        // Returns event instead of response
        return {
          id: cmd.id,
          type: "event" as const,
          ts: new Date().toISOString(),
          topic: "test.topic",
        };
      });

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
      });

      const command = createCommandEnvelope("workspace.create");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_BOUNDARY_RESPONSE");
      expect(response.error?.message).toBe("boundary adapter must return response");
      expect(response.error?.details).toEqual({
        boundary: "local_control",
        adapter: "local_bus",
      });
    });

    it("should return INVALID_BOUNDARY_RESPONSE error from tool adapter", async () => {
      const dispatchLocal = vi.fn();
      const dispatchTool = vi.fn(async (cmd: LocalBusEnvelope) => {
        // Returns invalid type
        return { ...cmd, type: "invalid" } as unknown as LocalBusEnvelope;
      });

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
      });

      const command = createCommandEnvelope("zmx.checkpoint");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_BOUNDARY_RESPONSE");
      expect(response.error?.details).toEqual({
        boundary: "tool_interop",
        adapter: "tool_bridge",
      });
    });

    it("should return INVALID_BOUNDARY_RESPONSE error from a2a adapter", async () => {
      const dispatchLocal = vi.fn();
      const dispatchA2A = vi.fn(async (cmd: LocalBusEnvelope) => {
        // Returns command instead of response
        return cmd;
      });

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchA2A,
      });

      const command = createCommandEnvelope("agent.run");
      const response = (await dispatcher(command)) as ResponseEnvelope;

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("INVALID_BOUNDARY_RESPONSE");
      expect(response.error?.details).toEqual({
        boundary: "agent_delegation",
        adapter: "a2a_bridge",
      });
    });
  });

  describe("successful responses", () => {
    it("should return successful response from local adapter", async () => {
      const expectedResponse = createResponseEnvelope(
        createCommandEnvelope("workspace.create"),
        "ok",
        { result: { workspace_id: "new-ws" } },
      );

      const dispatchLocal = vi.fn(async () => expectedResponse);

      const dispatcher = createBoundaryDispatcher({ dispatchLocal });

      const command = createCommandEnvelope("workspace.create");
      const response = await dispatcher(command);

      expect(response).toEqual(expectedResponse);
      expect(response.status).toBe("ok");
    });

    it("should return error response from local adapter", async () => {
      const expectedResponse = createResponseEnvelope(
        createCommandEnvelope("workspace.create"),
        "error",
      );

      const dispatchLocal = vi.fn(async () => expectedResponse);

      const dispatcher = createBoundaryDispatcher({ dispatchLocal });

      const command = createCommandEnvelope("workspace.create");
      const response = await dispatcher(command);

      expect(response).toEqual(expectedResponse);
      expect(response.status).toBe("error");
    });

    it("should return successful response from tool adapter", async () => {
      const expectedResponse = createResponseEnvelope(
        createCommandEnvelope("zmx.checkpoint"),
        "ok",
        { result: { checkpoint_id: "ckpt-123" } },
      );

      const dispatchLocal = vi.fn();
      const dispatchTool = vi.fn(async () => expectedResponse);

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchTool,
      });

      const command = createCommandEnvelope("zmx.checkpoint");
      const response = await dispatcher(command);

      expect(response).toEqual(expectedResponse);
      expect(response.status).toBe("ok");
    });

    it("should return successful response from a2a adapter", async () => {
      const expectedResponse = createResponseEnvelope(createCommandEnvelope("agent.run"), "ok", {
        result: { agent_result: "completed" },
      });

      const dispatchLocal = vi.fn();
      const dispatchA2A = vi.fn(async () => expectedResponse);

      const dispatcher = createBoundaryDispatcher({
        dispatchLocal,
        dispatchA2A,
      });

      const command = createCommandEnvelope("agent.run");
      const response = await dispatcher(command);

      expect(response).toEqual(expectedResponse);
      expect(response.status).toBe("ok");
    });
  });

  describe("envelope metadata preservation", () => {
    it("should preserve envelope metadata in error responses", async () => {
      const dispatchLocal = vi.fn();

      const dispatcher = createBoundaryDispatcher({ dispatchLocal });

      const command = createCommandEnvelope("workspace.create", {
        workspace_id: "custom-ws-id",
        lane_id: "custom-lane-id",
        session_id: "custom-session-id",
        terminal_id: "custom-term-id",
        correlation_id: "custom-corr-id",
      });

      const invalidCommand: LocalBusEnvelope = {
        ...command,
        type: "event",
      };

      const response = (await dispatcher(invalidCommand)) as ResponseEnvelope;

      expect(response.id).toBe(command.id);
      expect(response.workspace_id).toBe("custom-ws-id");
      expect(response.lane_id).toBe("custom-lane-id");
      expect(response.session_id).toBe("custom-session-id");
      expect(response.terminal_id).toBe("custom-term-id");
      expect(response.correlation_id).toBe("custom-corr-id");
    });
  });

  describe("edge cases", () => {
    it("should handle command with missing method", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) => createResponseEnvelope(cmd));

      const dispatcher = createBoundaryDispatcher({ dispatchLocal });

      const command: LocalBusEnvelope = {
        id: "test-id",
        type: "command",
        ts: new Date().toISOString(),
        // Method is missing - defaults to unknown
      };

      const response = await dispatcher(command);
      expect(response.type).toBe("response");
    });

    it("should handle multiple sequential dispatches", async () => {
      const dispatchLocal = vi.fn(async (cmd: LocalBusEnvelope) =>
        createResponseEnvelope(cmd, "ok"),
      );

      const dispatcher = createBoundaryDispatcher({ dispatchLocal });

      const cmd1 = createCommandEnvelope("workspace.create");
      const cmd2 = createCommandEnvelope("project.clone");
      const cmd3 = createCommandEnvelope("session.create");

      const response1 = await dispatcher(cmd1);
      const response2 = await dispatcher(cmd2);
      const response3 = await dispatcher(cmd3);

      expect(response1.status).toBe("ok");
      expect(response2.status).toBe("ok");
      expect(response3.status).toBe("ok");
      expect(dispatchLocal).toHaveBeenCalledTimes(3);
    });
  });
});
