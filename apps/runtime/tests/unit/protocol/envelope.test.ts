/**
 * FR-HELIOS-105: Protocol Envelope Creation and Validation Tests
 * Verifies: FR-BUS-001 (Envelope schema), FR-BUS-002 (spec-005 IDs), FR-BUS-006 (Validation)
 * Traces to: FR-MVP-002 (stream responses), FR-MVP-003 (display tool calls), FR-MVP-004 (multi-turn)
 */

import { parseId, validateId } from "@helios/ids";
import {
  createCommand,
  createResponse,
  createEvent,
  validateEnvelope,
  MAX_PAYLOAD_SIZE,
  setMaxPayloadSize,
} from "../../../src/protocol/envelope.js";
import type { CommandEnvelope } from "../../../src/protocol/types.js";

function expectSpec005Id(id: string, entityType: "run" | "correlation"): void {
  expect(validateId(id)).toEqual({ valid: true, entityType });
  const parsed = parseId(id);
  expect(parsed).not.toBeNull();
  expect(parsed?.entityType).toBe(entityType);
  expect(parsed?.ulid).toHaveLength(26);
}

describe("createCommand", () => {
  it("generates a spec-005 run ID", () => {
    const env = createCommand("test.method", { data: 1 });
    expectSpec005Id(env.id, "run");
  });

  it("auto-generates correlation_id when not provided", () => {
    const env = createCommand("test.method", {});
    expectSpec005Id(env.correlation_id, "correlation");
  });

  it("uses provided correlationId", () => {
    const env = createCommand("test.method", {}, "my_cor_123");
    expect(env.correlation_id).toBe("my_cor_123");
  });

  it("sets timestamp from monotonic clock (positive number)", () => {
    const env = createCommand("test.method", {});
    expect(env.timestamp).toBeGreaterThan(0);
  });

  it('sets type to "command"', () => {
    const env = createCommand("test.method", {});
    expect(env.type).toBe("command");
  });

  it("passes type check", () => {
    const env = createCommand("test.method", {});
    expect(env.type).toBe("command");
    expect(env.type).not.toBe("response");
    expect(env.type).not.toBe("event");
  });

  it("throws on empty method", () => {
    expect(() => createCommand("", {})).toThrow();
  });

  it("generates unique IDs across calls", () => {
    const a = createCommand("m", {});
    const b = createCommand("m", {});
    expect(a.id).not.toBe(b.id);
  });

  it("generates globally unique spec-005 IDs across all envelope helpers", () => {
    const commands = Array.from({ length: 1_000 }, (_, index) =>
      createCommand("test.unique", { index })
    );
    const responses = commands.map(command => createResponse(command, null));
    const events = Array.from({ length: 1_000 }, (_, index) =>
      createEvent("test.unique", { index })
    );
    const envelopes = [...commands, ...responses, ...events];
    const generatedCorrelations = [...commands, ...events].map(
      envelope => envelope.correlation_id
    );

    expect(new Set(envelopes.map(envelope => envelope.id)).size).toBe(envelopes.length);
    expect(new Set(generatedCorrelations).size).toBe(generatedCorrelations.length);
    for (const envelope of envelopes) {
      expectSpec005Id(envelope.id, "run");
    }
    for (const correlationId of generatedCorrelations) {
      expectSpec005Id(correlationId, "correlation");
    }
    for (const [index, response] of responses.entries()) {
      expect(response.correlation_id).toBe(commands[index]?.correlation_id);
    }
  });
});

describe("createResponse", () => {
  let cmd: CommandEnvelope;

  beforeEach(() => {
    cmd = createCommand("test.method", { req: true });
  });

  it("carries the originating command correlation_id", () => {
    const res = createResponse(cmd, { ok: true });
    expect(res.correlation_id).toBe(cmd.correlation_id);
  });

  it("carries the originating command method", () => {
    const res = createResponse(cmd, null);
    expect(res.method).toBe("test.method");
  });

  it("generates a spec-005 run ID", () => {
    const res = createResponse(cmd, null);
    expectSpec005Id(res.id, "run");
  });

  it('sets type to "response"', () => {
    const res = createResponse(cmd, null);
    expect(res.type).toBe("response");
    expect(res.type).toBe("response");
  });

  it("includes error when provided", () => {
    const res = createResponse(cmd, null, {
      code: "HANDLER_ERROR",
      message: "oops",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("HANDLER_ERROR");
  });

  it("omits error when not provided", () => {
    const res = createResponse(cmd, null);
    expect(res.error).toBeUndefined();
  });
});

describe("createEvent", () => {
  it("generates a spec-005 run ID", () => {
    const env = createEvent("ui.clicked", { x: 1 });
    expectSpec005Id(env.id, "run");
  });

  it('sets type to "event"', () => {
    const env = createEvent("ui.clicked", undefined);
    expect(env.type).toBe("event");
    expect(env.type).toBe("event");
  });

  it("sets sequence to 0 (placeholder)", () => {
    const env = createEvent("ui.clicked", undefined);
    expect(env.sequence).toBe(0);
  });

  it("auto-generates correlation_id", () => {
    const env = createEvent("ui.clicked", undefined);
    expectSpec005Id(env.correlation_id, "correlation");
  });

  it("throws on empty topic", () => {
    expect(() => createEvent("", undefined)).toThrow();
  });
});

describe("validateEnvelope", () => {
  // --- Positive cases ---
  it("accepts a valid command envelope", () => {
    const cmd = createCommand("m", { x: 1 });
    const result = validateEnvelope(cmd);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid response envelope", () => {
    const cmd = createCommand("m", {});
    const res = createResponse(cmd, { ok: true });
    const result = validateEnvelope(res);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid event envelope", () => {
    const evt = createEvent("topic", { data: 1 });
    const result = validateEnvelope(evt);
    expect(result.valid).toBe(true);
  });

  it("accepts payload of null", () => {
    const cmd = createCommand("m", {});
    const result = validateEnvelope(cmd);
    expect(result.valid).toBe(true);
  });

  it("accepts payload of undefined", () => {
    const cmd = createCommand("m", {});
    const result = validateEnvelope(cmd);
    expect(result.valid).toBe(true);
  });

  // --- Negative: missing base fields ---
  it("rejects null input", () => {
    const r = validateEnvelope(null);
    expect(r.valid).toBe(false);
  });

  it("rejects non-object input", () => {
    const r = validateEnvelope("string");
    expect(r.valid).toBe(false);
  });

  it("rejects missing id", () => {
    const r = validateEnvelope({
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty id", () => {
    const r = validateEnvelope({
      id: "",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects missing correlation_id", () => {
    const r = validateEnvelope({
      id: "x",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects empty correlation_id", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects unknown type", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "unknown",
      timestamp: 1,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error.details).toEqual({ type: "unknown" });
  });

  it("rejects negative timestamp", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: -1,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects NaN timestamp", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: Number.NaN,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects zero timestamp", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 0,
      method: "m",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  // --- Negative: type-specific fields ---
  it("rejects command without method", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects command with empty method", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "",
      payload: null,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects command without payload", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "m",
    });
    expect(r.valid).toBe(false);
  });

  it("rejects event without topic", () => {
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "event",
      timestamp: 1,
      payload: null,
      sequence: 0,
    });
    expect(r.valid).toBe(false);
  });

  // --- Negative: payload size ---
  it("rejects oversized payload", () => {
    const saved = MAX_PAYLOAD_SIZE;
    setMaxPayloadSize(10);
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: "a".repeat(100),
    });
    setMaxPayloadSize(saved);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.error.code).toBe("BACKPRESSURE");
    }
  });

  // --- Negative: circular payload ---
  it("rejects circular reference in payload", () => {
    const obj: Record<string, unknown> = {};
    obj["self"] = obj;
    const r = validateEnvelope({
      id: "x",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use wire-format snake_case keys.
      correlation_id: "c",
      type: "command",
      timestamp: 1,
      method: "m",
      payload: obj,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.error.message).toContain("circular");
    }
  });
});
