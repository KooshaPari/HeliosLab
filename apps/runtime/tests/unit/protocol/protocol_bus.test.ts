/**
 * FR-HELIOS-102: Protocol Bus and Validator Unit Tests
 * Verifies: FR-BUS-002 (Envelope validation), FR-BUS-003 (Lifecycle sequencing)
 */
import { describe, expect, test } from "bun:test";
import { InMemoryLocalBus } from "../../../src/protocol/bus";
import { ProtocolValidationError, type LocalBusEnvelope } from "../../../src/protocol/types";
import { validateEnvelope } from "../../../src/protocol/validator";

function createLifecycleCommand(overrides: Partial<LocalBusEnvelope> = {}): LocalBusEnvelope {
  return {
    id: "cmd-1",
    type: "command",
    ts: "2026-02-26T00:00:00.000Z",
    // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
    workspace_id: "ws-1",
    // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
    lane_id: "lane-1",
    // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
    session_id: "session-1",
    // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
    correlation_id: "corr-1",
    method: "session.attach",
    payload: {},
    ...overrides,
  };
}

describe("protocol validator", () => {
  test("rejects malformed envelope with stable error semantics", () => {
    expect(() => validateEnvelope({ id: "evt-1", ts: "2026-02-26T00:00:00.000Z" })).toThrow(
      ProtocolValidationError
    );
    expect(() => validateEnvelope({ id: "evt-1", ts: "2026-02-26T00:00:00.000Z" })).toThrow(
      "Envelope field 'type' is required"
    );
  });

  test("returns error response when lifecycle command is missing correlation_id", async () => {
    const bus = new InMemoryLocalBus();
    const command = createLifecycleCommand({ correlation_id: undefined });

    await expect(bus.request(command)).resolves.toMatchObject({
      type: "response",
      status: "error",
      error: { code: "MISSING_CORRELATION_ID" },
    });
  });

  test("rejects timestamps without RFC3339 timezone", () => {
    expect(() =>
      validateEnvelope({
        id: "evt-1",
        type: "event",
        ts: "2026-02-26T00:00:00",
        topic: "workspace.opened",
        payload: {},
      })
    ).toThrow("Envelope field 'ts' must be an RFC3339 timestamp with timezone");
  });

  test("accepts RFC3339 timestamps with explicit timezone offset", () => {
    const envelope = validateEnvelope({
      id: "evt-1",
      type: "event",
      ts: "2026-02-26T00:00:00+00:00",
      topic: "workspace.opened",
      payload: {},
    });

    expect(envelope.ts).toBe("2026-02-26T00:00:00+00:00");
  });

  test("rejects optional timestamp without RFC3339 timezone", () => {
    expect(() =>
      validateEnvelope({
        id: "evt-1",
        type: "event",
        ts: "2026-02-26T00:00:00.000Z",
        timestamp: "2026-02-26T00:00:00",
        topic: "workspace.opened",
        payload: {},
      })
    ).toThrow("Envelope field 'timestamp' must be an RFC3339 timestamp with timezone");
  });

  test("accepts optional timestamp with RFC3339 timezone", () => {
    const envelope = validateEnvelope({
      id: "evt-1",
      type: "event",
      ts: "2026-02-26T00:00:00.000Z",
      timestamp: "2026-02-26T00:00:00+00:00",
      topic: "workspace.opened",
      payload: {},
    });

    expect(envelope.timestamp as unknown).toBe("2026-02-26T00:00:00+00:00");
  });

  test("rejects timestamps without RFC3339 timezone", () => {
    expect(() =>
      validateEnvelope({
        id: "evt-1",
        type: "event",
        ts: "2026-02-26T00:00:00",
        topic: "workspace.opened",
        payload: {},
      })
    ).toThrow("Envelope field 'ts' must be an RFC3339 timestamp with timezone");
  });

  test("accepts RFC3339 timestamps with explicit timezone offset", () => {
    const envelope = validateEnvelope({
      id: "evt-1",
      type: "event",
      ts: "2026-02-26T00:00:00+00:00",
      topic: "workspace.opened",
      payload: {},
    });

    expect(envelope.ts).toBe("2026-02-26T00:00:00+00:00");
  });

  test("rejects optional timestamp without RFC3339 timezone", () => {
    expect(() =>
      validateEnvelope({
        id: "evt-1",
        type: "event",
        ts: "2026-02-26T00:00:00.000Z",
        timestamp: "2026-02-26T00:00:00",
        topic: "workspace.opened",
        payload: {},
      })
    ).toThrow("Envelope field 'timestamp' must be an RFC3339 timestamp with timezone");
  });

  test("accepts optional timestamp with RFC3339 timezone", () => {
    const envelope = validateEnvelope({
      id: "evt-1",
      type: "event",
      ts: "2026-02-26T00:00:00.000Z",
      timestamp: "2026-02-26T00:00:00+00:00",
      topic: "workspace.opened",
      payload: {},
    });

    expect(envelope.timestamp as unknown).toBe("2026-02-26T00:00:00+00:00");
  });
});

describe("protocol sequencing and audit", () => {
  test("stamps deterministic sequence for lifecycle events", async () => {
    const bus = new InMemoryLocalBus();
    const command = createLifecycleCommand();

    const response = await bus.request(command);
    expect(response.type).toBe("response");
    expect(response.status).toBe("ok");

    const events = bus.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.topic).toBe("session.attach.started");
    expect(events[1]?.topic).toBe("session.attached");
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.sequence).toBe(2);
  });

  test("rejects out-of-order lifecycle topic events", async () => {
    const bus = new InMemoryLocalBus();
    await expect(
      bus.publish({
        id: "evt-1",
        type: "event",
        ts: "2026-02-26T00:00:00.000Z",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        workspace_id: "ws-1",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        lane_id: "lane-1",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        session_id: "session-1",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        correlation_id: "corr-1",
        topic: "session.attached",
        payload: {},
      })
    ).rejects.toMatchObject({
      name: "ProtocolValidationError",
      code: "ORDERING_VIOLATION",
    });
  });

  test("records accepted and rejected publish attempts in audit sink", async () => {
    const bus = new InMemoryLocalBus();
    await bus.publish({
      id: "evt-accepted",
      type: "event",
      ts: "2026-02-26T00:00:00.000Z",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
      workspace_id: "ws-1",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
      lane_id: "lane-1",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
      correlation_id: "corr-accepted",
      topic: "lane.create.started",
      payload: {},
    });

    await expect(
      bus.publish({
        id: "evt-rejected",
        type: "event",
        ts: "2026-02-26T00:00:00.000Z",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        workspace_id: "ws-1",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        lane_id: "lane-1",
        // biome-ignore lint/style/useNamingConvention: Protocol fixtures use protocol envelope snake_case keys.
        correlation_id: "corr-accepted",
        topic: "lane.create.started",
        payload: {},
      })
    ).rejects.toMatchObject({
      name: "ProtocolValidationError",
      code: "ORDERING_VIOLATION",
    });

    const records = await bus.getAuditRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.outcome).toBe("accepted");
    expect(records[1]?.outcome).toBe("rejected");
  });

  test("clears lifecycle progress after lane attach/cleanup success topics", async () => {
    const bus = new InMemoryLocalBus();

    await expect(
      bus.publish({
        id: "evt-lane-attach-start-1",
        type: "event",
        ts: "2026-02-26T00:00:00.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-attach",
        topic: "lane.attach.started",
        payload: {},
      })
    ).resolves.toBeUndefined();

    await expect(
      bus.publish({
        id: "evt-lane-attached",
        type: "event",
        ts: "2026-02-26T00:00:01.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-attach",
        topic: "lane.attached",
        payload: {},
      })
    ).resolves.toBeUndefined();

    await expect(
      bus.publish({
        id: "evt-lane-attach-start-2",
        type: "event",
        ts: "2026-02-26T00:00:02.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-attach",
        topic: "lane.attach.started",
        payload: {},
      })
    ).resolves.toBeUndefined();

    await expect(
      bus.publish({
        id: "evt-lane-cleanup-start-1",
        type: "event",
        ts: "2026-02-26T00:00:03.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-cleanup",
        topic: "lane.cleanup.started",
        payload: {},
      })
    ).resolves.toBeUndefined();

    await expect(
      bus.publish({
        id: "evt-lane-cleaned",
        type: "event",
        ts: "2026-02-26T00:00:04.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-cleanup",
        topic: "lane.cleaned",
        payload: {},
      })
    ).resolves.toBeUndefined();

    await expect(
      bus.publish({
        id: "evt-lane-cleanup-start-2",
        type: "event",
        ts: "2026-02-26T00:00:05.000Z",
        workspace_id: "ws-1",
        lane_id: "lane-1",
        correlation_id: "corr-lane-cleanup",
        topic: "lane.cleanup.started",
        payload: {},
      })
    ).resolves.toBeUndefined();
  });

  test("returns authoritative context IDs in lifecycle responses when provided", async () => {
    const bus = new InMemoryLocalBus();
    const laneId = "lane-authoritative";
    const sessionId = "session-authoritative";

    const laneAttach = await bus.request(
      createLifecycleCommand({
        method: "lane.attach",
        lane_id: laneId,
        correlation_id: "corr-lane-authoritative",
        payload: {},
      })
    );

    expect(laneAttach.type).toBe("response");
    expect(laneAttach.status).toBe("ok");
    expect(laneAttach.result).toMatchObject({ lane_id: laneId });

    const sessionAttach = await bus.request(
      createLifecycleCommand({
        method: "session.attach",
        session_id: sessionId,
        correlation_id: "corr-session-authoritative",
        payload: {},
      })
    );

    expect(sessionAttach.type).toBe("response");
    expect(sessionAttach.status).toBe("ok");
    expect(sessionAttach.result).toMatchObject({ session_id: sessionId });
  });

  test("keeps session detached when session.attach fails", async () => {
    const bus = new InMemoryLocalBus();
    const response = await bus.request(
      createLifecycleCommand({
        // biome-ignore lint/style/useNamingConvention: Protocol fixture payload uses snake_case.
        payload: { force_error: true },
      })
    );

    expect(response.type).toBe("response");
    expect(response.status).toBe("error");
    expect(bus.getState().session).toBe("detached");

    const events = bus.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.topic).toBe("session.attach.started");
    expect(events[1]?.topic).toBe("session.attach.failed");
  });
});
