/**
 * A2A Dispatch Tests
 *
 * Verifies agent delegation dispatch and subprocess execution
 */

import { describe, it, expect, beforeEach, expectTypeOf } from "vitest";
import { createA2ADispatch } from "./a2a-dispatch";
import type { LocalBusEnvelope } from "../runtime/protocol/types";

const createCommand = (method: string, payload?: Record<string, unknown>): LocalBusEnvelope => ({
  id: "test-456",
  type: "command",
  ts: new Date().toISOString(),
  method,
  payload,
});

describe(createA2ADispatch, () => {
  let dispatch: ReturnType<typeof createA2ADispatch>;

  beforeEach(() => {
    dispatch = createA2ADispatch();
  });

  it("returns a function", () => {
    expectTypeOf(dispatch).toBeFunction();
  });

  describe("agent.run", () => {
    it("returns error when ACP endpoint not configured", async () => {
      const command = createCommand("agent.run", { message: "test prompt" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("ACP_NOT_CONFIGURED");
    });

    it("returns error envelope with proper structure when ACP not configured", async () => {
      const command = createCommand("agent.run", { message: "test" });
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "error");
      expect(response.result).toBeNull();
      expect(response.error?.code).toBe("ACP_NOT_CONFIGURED");
    });
  });

  describe("agent.cancel", () => {
    it("returns error when agent not found", async () => {
      const command = createCommand("agent.cancel");
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("AGENT_NOT_FOUND");
    });

    it("returns proper error envelope structure when agent not found", async () => {
      const command = createCommand("agent.cancel");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "error");
      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
    });
  });

  describe("agent.list", () => {
    it("returns empty list when no agents", async () => {
      const command = createCommand("agent.list");
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.agents).toBeDefined();
      expect(Array.isArray(response.result?.agents)).toBeTruthy();
      expect(response.result?.count).toBe(0);
    });

    it("has correct success envelope structure", async () => {
      const command = createCommand("agent.list");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "ok");
      expect(response.result).toBeDefined();
      expect(response.error).toBeNull();
    });
  });

  describe("agent.status", () => {
    it("returns agent status information", async () => {
      const command = createCommand("agent.status");
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.configured).toBeDefined();
      expectTypeOf(response.result?.configured).toBeBoolean();
      expect(response.result?.acpClientInitialized).toBeDefined();
      expectTypeOf(response.result?.acpClientInitialized).toBeBoolean();
      expect(response.result?.activeAgentCount).toBeDefined();
      expectTypeOf(response.result?.activeAgentCount).toBeNumber();
    });

    it("returns zero active agents when none running", async () => {
      const command = createCommand("agent.status");
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.activeAgentCount).toBe(0);
    });

    it("has correct success envelope structure", async () => {
      const command = createCommand("agent.status");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "ok");
      expect(response.result).toBeDefined();
      expect(response.error).toBeNull();
    });
  });

  describe("unknown method", () => {
    it("returns UNKNOWN_A2A_METHOD error", async () => {
      const command = createCommand("agent.unknown");
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNKNOWN_A2A_METHOD");
      expect(response.error?.message).toContain("unknown a2a method");
      expect(response.id).toBe("test-456");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
      expect(response.result).toBeNull();
    });

    it("has correct error envelope structure", async () => {
      const command = createCommand("agent.unknown");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "error");
      expect(response.error?.retryable).toBeFalsy();
      expect(response.error?.details?.method).toBe("agent.unknown");
    });
  });

  describe("envelope structure", () => {
    it("has id from command", async () => {
      const command = createCommand("agent.list");
      command.id = "custom-id-789";
      const response = await dispatch(command);

      expect(response.id).toBe("custom-id-789");
    });

    it("has type set to 'response'", async () => {
      const command = createCommand("agent.list");
      const response = await dispatch(command);

      expect(response.type).toBe("response");
    });

    it("has timestamp string", async () => {
      const command = createCommand("agent.list");
      const response = await dispatch(command);

      expectTypeOf(response.ts).toBeString();
      expect(response.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("has status field for all responses", async () => {
      const command1 = createCommand("agent.list");
      const response1 = await dispatch(command1);
      expect(response1.status).toBe("ok");

      const command2 = createCommand("agent.unknown");
      const response2 = await dispatch(command2);
      expect(response2.status).toBe("error");
    });

    it("has error object with code and message for errors", async () => {
      const command = createCommand("agent.unknown");
      const response = await dispatch(command);

      expect(response.error).toBeDefined();
      expectTypeOf(response.error?.code).toBeString();
      expectTypeOf(response.error?.message).toBeString();
      expect(response.error?.retryable).toBeFalsy();
    });

    it("has error details with method for errors", async () => {
      const command = createCommand("agent.unknown");
      const response = await dispatch(command);

      expect(response.error?.details?.method).toBe("agent.unknown");
    });

    it("has result set for successful responses", async () => {
      const command = createCommand("agent.list");
      const response = await dispatch(command);

      expect(response.result).toBeDefined();
      expect(response.error).toBeNull();
    });

    it("has result set to null for error responses", async () => {
      const command = createCommand("agent.unknown");
      const response = await dispatch(command);

      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
    });
  });
});
