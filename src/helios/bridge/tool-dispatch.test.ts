/**
 * Tool Dispatch Tests
 *
 * Verifies tool dispatch routing and error handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createToolDispatch } from "./tool-dispatch";
import type { LocalBusEnvelope } from "../runtime/protocol/types";

const createCommand = (method: string, payload?: Record<string, unknown>): LocalBusEnvelope => ({
  id: "test-123",
  type: "command",
  ts: new Date().toISOString(),
  method,
  payload,
});

describe("createToolDispatch", () => {
  let dispatch: ReturnType<typeof createToolDispatch>;

  beforeEach(() => {
    dispatch = createToolDispatch();
  });

  it("returns a function", () => {
    expect(typeof dispatch).toBe("function");
  });

  describe("unknown method", () => {
    it("returns UNKNOWN_TOOL_METHOD error", async () => {
      const command = createCommand("unknown.method");
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNKNOWN_TOOL_METHOD");
      expect(response.error?.message).toContain("unknown tool method");
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
      expect(response.result).toBeNull();
    });
  });

  describe("share.upterm.start", () => {
    it("returns TOOL_EXECUTION_FAILED when upterm CLI not available", async () => {
      const command = createCommand("share.upterm.start", { terminalId: "term-1" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("TOOL_EXECUTION_FAILED");
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
    });

    it("has correct response envelope structure", async () => {
      const command = createCommand("share.upterm.start", { terminalId: "term-1" });
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status");
      expect(response.error?.details?.method).toBe("share.upterm.start");
    });
  });

  describe("share.upterm.stop", () => {
    it("returns TOOL_EXECUTION_FAILED when upterm CLI not available", async () => {
      const command = createCommand("share.upterm.stop", { terminalId: "term-1" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("TOOL_EXECUTION_FAILED");
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
    });
  });

  describe("share.tmate.start", () => {
    it("returns TOOL_EXECUTION_FAILED when tmate CLI not available", async () => {
      const command = createCommand("share.tmate.start", { terminalId: "term-2" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("TOOL_EXECUTION_FAILED");
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
    });

    it("has correct response envelope structure", async () => {
      const command = createCommand("share.tmate.start", { terminalId: "term-2" });
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status");
      expect(response.error?.details?.method).toBe("share.tmate.start");
    });
  });

  describe("share.tmate.stop", () => {
    it("returns a valid response envelope", async () => {
      const command = createCommand("share.tmate.stop", { terminalId: "term-2" });
      const response = await dispatch(command);
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(["ok", "error"]).toContain(response.status);
    });
  });

  describe("zmx.checkpoint", () => {
    it("returns a valid response envelope", async () => {
      const command = createCommand("zmx.checkpoint", { sessionId: "session-1" });
      const response = await dispatch(command);
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(["ok", "error"]).toContain(response.status);
    });
  });

  describe("zmx.restore", () => {
    it("returns a valid response envelope", async () => {
      const command = createCommand("zmx.restore", { checkpointId: "cp-1" });
      const response = await dispatch(command);
      expect(response.id).toBe("test-123");
      expect(response.type).toBe("response");
      expect(["ok", "error"]).toContain(response.status);
    });
  });

  describe("response envelope structure", () => {
    it("has id from command", async () => {
      const command = createCommand("unknown.method");
      command.id = "custom-id-456";
      const response = await dispatch(command);

      expect(response.id).toBe("custom-id-456");
    });

    it("has type set to 'response'", async () => {
      const command = createCommand("unknown.method");
      const response = await dispatch(command);

      expect(response.type).toBe("response");
    });

    it("has timestamp string", async () => {
      const command = createCommand("unknown.method");
      const response = await dispatch(command);

      expect(typeof response.ts).toBe("string");
      expect(response.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("has status field", async () => {
      const command = createCommand("unknown.method");
      const response = await dispatch(command);

      expect(["ok", "error"]).toContain(response.status);
    });
  });
});
