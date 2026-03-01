/**
 * Muxer Dispatch Tests
 *
 * Verifies muxer dispatch routing and error handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMuxerDispatch } from "./muxer-dispatch";
import type { LocalBusEnvelope } from "../runtime/protocol/types";

const createCommand = (method: string, payload?: Record<string, unknown>): LocalBusEnvelope => ({
  id: "test-mux-123",
  type: "command",
  ts: new Date().toISOString(),
  method,
  payload,
});

describe("createMuxerDispatch", () => {
  let dispatch: ReturnType<typeof createMuxerDispatch>;

  beforeEach(() => {
    dispatch = createMuxerDispatch();
  });

  it("returns a function", () => {
    expect(typeof dispatch).toBe("function");
  });

  describe("muxer.list", () => {
    it("returns all available muxer types", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.available).toBeDefined();
      expect(Array.isArray(response.result?.available)).toBe(true);
      expect(response.result?.count).toBe(5);
    });

    it("includes all expected muxer types", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      const types = response.result?.available as string[];
      expect(types).toContain("zellij");
      expect(types).toContain("tmate");
      expect(types).toContain("upterm");
      expect(types).toContain("par");
      expect(types).toContain("zmx");
    });

    it("returns proper success envelope structure", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "ok");
      expect(response.result).toBeDefined();
      expect(response.error).toBeNull();
    });
  });

  describe("muxer.spawn", () => {
    it("returns error when type not provided", async () => {
      const command = createCommand("muxer.spawn", {});
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("MUXER_TYPE_REQUIRED");
    });

    it("returns error for unsupported muxer type", async () => {
      const command = createCommand("muxer.spawn", { type: "unknown" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNSUPPORTED_MUXER_TYPE");
    });

    it("successfully spawns a new muxer session with zellij", async () => {
      const command = createCommand("muxer.spawn", { type: "zellij" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.sessionId).toBeDefined();
      expect(response.result?.type).toBe("zellij");
      expect(response.result?.status).toBe("active");
    });

    it("successfully spawns a new muxer session with tmate", async () => {
      const command = createCommand("muxer.spawn", { type: "tmate" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.sessionId).toBeDefined();
      expect(response.result?.type).toBe("tmate");
      expect(response.result?.status).toBe("active");
    });

    it("successfully spawns a new muxer session with upterm", async () => {
      const command = createCommand("muxer.spawn", { type: "upterm" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.sessionId).toBeDefined();
      expect(response.result?.type).toBe("upterm");
    });

    it("successfully spawns a new muxer session with par", async () => {
      const command = createCommand("muxer.spawn", { type: "par" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.sessionId).toBeDefined();
      expect(response.result?.type).toBe("par");
    });

    it("successfully spawns a new muxer session with zmx", async () => {
      const command = createCommand("muxer.spawn", { type: "zmx" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.sessionId).toBeDefined();
      expect(response.result?.type).toBe("zmx");
    });

    it("generates unique session IDs for multiple spawns", async () => {
      const command1 = createCommand("muxer.spawn", { type: "zellij" });
      const response1 = await dispatch(command1);

      const command2 = createCommand("muxer.spawn", { type: "zellij" });
      const response2 = await dispatch(command2);

      const id1 = response1.result?.sessionId;
      const id2 = response2.result?.sessionId;

      expect(id1).not.toBe(id2);
    });

    it("uses provided name when spawning", async () => {
      const command = createCommand("muxer.spawn", {
        type: "zellij",
        name: "my-session",
      });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.name).toBe("my-session");
    });

    it("generates default name when not provided", async () => {
      const command = createCommand("muxer.spawn", { type: "zellij" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.name).toBeDefined();
      expect(typeof response.result?.name).toBe("string");
    });

    it("returns proper success envelope structure", async () => {
      const command = createCommand("muxer.spawn", { type: "zellij" });
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status");
      expect(response.result).toBeDefined();
    });

    it("includes createdAt timestamp in result", async () => {
      const command = createCommand("muxer.spawn", { type: "zellij" });
      const response = await dispatch(command);

      expect(response.status).toBe("ok");
      expect(response.result?.createdAt).toBeDefined();
      expect(typeof response.result?.createdAt).toBe("string");
    });
  });

  describe("muxer.attach", () => {
    it("returns error when sessionId not provided", async () => {
      const command = createCommand("muxer.attach", {});
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("SESSION_ID_REQUIRED");
    });

    it("returns error when session not found", async () => {
      const command = createCommand("muxer.attach", { sessionId: "invalid-id" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("MUXER_SESSION_NOT_FOUND");
    });

    it("successfully attaches to existing session", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Now attach to it
      const attachCmd = createCommand("muxer.attach", { sessionId });
      const attachResp = await dispatch(attachCmd);

      expect(attachResp.status).toBe("ok");
      expect(attachResp.result?.attached).toBe(true);
      expect(attachResp.result?.sessionId).toBe(sessionId);
    });

    it("returns proper success envelope structure", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Attach
      const attachCmd = createCommand("muxer.attach", { sessionId });
      const attachResp = await dispatch(attachCmd);

      expect(attachResp).toHaveProperty("id");
      expect(attachResp).toHaveProperty("type", "response");
      expect(attachResp).toHaveProperty("ts");
      expect(attachResp).toHaveProperty("status", "ok");
      expect(attachResp.error).toBeNull();
    });
  });

  describe("muxer.detach", () => {
    it("returns error when sessionId not provided", async () => {
      const command = createCommand("muxer.detach", {});
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("SESSION_ID_REQUIRED");
    });

    it("returns error when session not found", async () => {
      const command = createCommand("muxer.detach", { sessionId: "invalid-id" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("MUXER_SESSION_NOT_FOUND");
    });

    it("successfully detaches from existing session", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Detach from it
      const detachCmd = createCommand("muxer.detach", { sessionId });
      const detachResp = await dispatch(detachCmd);

      expect(detachResp.status).toBe("ok");
      expect(detachResp.result?.detached).toBe(true);
      expect(detachResp.result?.sessionId).toBe(sessionId);
    });

    it("returns proper success envelope structure", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Detach
      const detachCmd = createCommand("muxer.detach", { sessionId });
      const detachResp = await dispatch(detachCmd);

      expect(detachResp).toHaveProperty("id");
      expect(detachResp).toHaveProperty("type", "response");
      expect(detachResp).toHaveProperty("ts");
      expect(detachResp).toHaveProperty("status", "ok");
      expect(detachResp.error).toBeNull();
    });
  });

  describe("muxer.kill", () => {
    it("returns error when sessionId not provided", async () => {
      const command = createCommand("muxer.kill", {});
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("SESSION_ID_REQUIRED");
    });

    it("returns error when session not found", async () => {
      const command = createCommand("muxer.kill", { sessionId: "invalid-id" });
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("MUXER_SESSION_NOT_FOUND");
    });

    it("successfully kills existing session", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Kill it
      const killCmd = createCommand("muxer.kill", { sessionId });
      const killResp = await dispatch(killCmd);

      expect(killResp.status).toBe("ok");
      expect(killResp.result?.killed).toBe(true);
      expect(killResp.result?.status).toBe("terminated");
      expect(killResp.result?.sessionId).toBe(sessionId);
    });

    it("removes session from active sessions after kill", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Kill it
      const killCmd = createCommand("muxer.kill", { sessionId });
      await dispatch(killCmd);

      // Try to attach - should fail
      const attachCmd = createCommand("muxer.attach", { sessionId });
      const attachResp = await dispatch(attachCmd);

      expect(attachResp.status).toBe("error");
      expect(attachResp.error?.code).toBe("MUXER_SESSION_NOT_FOUND");
    });

    it("returns proper success envelope structure", async () => {
      // First spawn a session
      const spawnCmd = createCommand("muxer.spawn", { type: "zellij" });
      const spawnResp = await dispatch(spawnCmd);
      const sessionId = spawnResp.result?.sessionId as string;

      // Kill
      const killCmd = createCommand("muxer.kill", { sessionId });
      const killResp = await dispatch(killCmd);

      expect(killResp).toHaveProperty("id");
      expect(killResp).toHaveProperty("type", "response");
      expect(killResp).toHaveProperty("ts");
      expect(killResp).toHaveProperty("status", "ok");
      expect(killResp.error).toBeNull();
    });
  });

  describe("unknown method", () => {
    it("returns UNKNOWN_MUXER_METHOD error", async () => {
      const command = createCommand("muxer.unknown");
      const response = await dispatch(command);

      expect(response.status).toBe("error");
      expect(response.error?.code).toBe("UNKNOWN_MUXER_METHOD");
      expect(response.error?.message).toContain("unknown muxer method");
      expect(response.id).toBe("test-mux-123");
      expect(response.type).toBe("response");
      expect(response.ts).toBeDefined();
      expect(response.result).toBeNull();
    });

    it("has correct error envelope structure", async () => {
      const command = createCommand("muxer.unknown");
      const response = await dispatch(command);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("ts");
      expect(response).toHaveProperty("status", "error");
      expect(response.error?.retryable).toBe(false);
      expect(response.error?.details?.method).toBe("muxer.unknown");
    });
  });

  describe("response envelope structure", () => {
    it("has id from command", async () => {
      const command = createCommand("muxer.list");
      command.id = "custom-id-999";
      const response = await dispatch(command);

      expect(response.id).toBe("custom-id-999");
    });

    it("has type set to 'response'", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      expect(response.type).toBe("response");
    });

    it("has timestamp string", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      expect(typeof response.ts).toBe("string");
      expect(response.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("has status field for all responses", async () => {
      const command1 = createCommand("muxer.list");
      const response1 = await dispatch(command1);
      expect(response1.status).toBe("ok");

      const command2 = createCommand("muxer.unknown");
      const response2 = await dispatch(command2);
      expect(response2.status).toBe("error");
    });

    it("has error object with code and message for errors", async () => {
      const command = createCommand("muxer.unknown");
      const response = await dispatch(command);

      expect(response.error).toBeDefined();
      expect(typeof response.error?.code).toBe("string");
      expect(typeof response.error?.message).toBe("string");
      expect(response.error?.retryable).toBe(false);
    });

    it("has error details with method for errors", async () => {
      const command = createCommand("muxer.unknown");
      const response = await dispatch(command);

      expect(response.error?.details?.method).toBe("muxer.unknown");
    });

    it("has result set for successful responses", async () => {
      const command = createCommand("muxer.list");
      const response = await dispatch(command);

      expect(response.result).toBeDefined();
      expect(response.error).toBeNull();
    });

    it("has result set to null for error responses", async () => {
      const command = createCommand("muxer.unknown");
      const response = await dispatch(command);

      expect(response.result).toBeNull();
      expect(response.error).toBeDefined();
    });
  });
});
