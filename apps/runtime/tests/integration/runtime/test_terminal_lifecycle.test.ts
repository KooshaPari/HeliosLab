/**
 * FR-HELIOS-081: Terminal Lifecycle Integration Tests
 * Verifies: FR-BND-001 (Terminal registry), FR-PTY-001 (PTY lifecycle), FR-BUS-008 (Correlation propagation)
 */
import { describe, expect, test } from "bun:test";

import { createRuntime } from "../../../src";


describe("terminal lifecycle and streaming data plane", () => {
  test("rejects lifecycle commands without correlation_id", async () => {
    const runtime = createRuntime();
    const response = await runtime.bus.request({
      id: "cmd-missing-correlation",
      type: "command",
      ts: new Date().toISOString(),
      method: "terminal.spawn",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
      payload: { session_id: "sess-1" },
    });
    expect(response.type).toBe("response");
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("MISSING_CORRELATION_ID");
  });

  test("spawns terminals, preserves correlation, and blocks cross-lane access", async () => {
    const runtime = createRuntime({ terminalBufferCapBytes: 1024 });

    const spawnOne = await runtime.spawnTerminal({
      command_id: "cmd-spawn-1",
      correlation_id: "corr-spawn-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
      title: "Terminal One",
    });
    const spawnTwo = await runtime.spawnTerminal({
      command_id: "cmd-spawn-2",
      correlation_id: "corr-spawn-2",
      workspace_id: "ws-1",
      lane_id: "lane-2",
      session_id: "sess-2",
      title: "Terminal Two",
    });

    expect(spawnOne.status).toBe("ok");
    expect(spawnTwo.status).toBe("ok");
    const terminalOneId = String(spawnOne.result?.terminal_id);
    expect(terminalOneId).toContain("sess-1");

    const inputOk = await runtime.inputTerminal({
      command_id: "cmd-input-1",
      correlation_id: "corr-input-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
      terminal_id: terminalOneId,
      data: "echo hello",
    });
    expect(inputOk.status).toBe("ok");
    expect(inputOk.correlation_id).toBe("corr-input-1");

    const inputCrossLane = await runtime.inputTerminal({
      command_id: "cmd-input-x",
      correlation_id: "corr-input-x",
      workspace_id: "ws-1",
      lane_id: "lane-2",
      session_id: "sess-1",
      terminal_id: terminalOneId,
      data: "should fail",
    });
    expect(inputCrossLane.status).toBe("error");
    expect(inputCrossLane.error?.code).toBe("TERMINAL_CONTEXT_MISMATCH");

    const resize = await runtime.resizeTerminal({
      command_id: "cmd-resize-1",
      correlation_id: "corr-resize-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-1",
      terminal_id: terminalOneId,
      cols: 120,
      rows: 40,
    });
    expect(resize.status).toBe("ok");

    const events = runtime.getEvents();
    const spawnOneEvents = events.filter(event => event.correlation_id === "corr-spawn-1");
    expect(spawnOneEvents.map(event => event.topic)).toEqual([
      "terminal.spawn.started",
      "terminal.state.changed",
      "terminal.state.changed",
      "terminal.spawned",
    ]);
    expect(spawnOneEvents.every(event => event.correlation_id === "corr-spawn-1")).toBe(true);

    const sequences = events.map(event => Number(event.sequence ?? 0));
    expect(sequences.every(sequence => sequence > 0)).toBe(true);
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sequences).toEqual(sorted);

    const auditRecords = await runtime.getAuditRecords();
    expect(auditRecords.length).toBeGreaterThanOrEqual(events.length);
    const spawnRecord = auditRecords.find(
      r => (r.envelope as Record<string, unknown>)?.correlation_id === "corr-spawn-1"
    );
    const firstEnvelope = (spawnRecord?.envelope ?? {}) as Record<string, unknown>;
    expect(firstEnvelope.correlation_id).toBe("corr-spawn-1");
  });

  test("uses bounded buffers and emits throttling events on overflow", async () => {
    const runtime = createRuntime({ terminalBufferCapBytes: 10 });

    const spawn = await runtime.spawnTerminal({
      command_id: "cmd-spawn-overflow",
      correlation_id: "corr-spawn-overflow",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-overflow",
    });
    const terminalId = String(spawn.result?.terminal_id);

    await runtime.inputTerminal({
      command_id: "cmd-input-overflow-1",
      correlation_id: "corr-input-overflow-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-overflow",
      terminal_id: terminalId,
      data: "12345678",
    });
    await runtime.inputTerminal({
      command_id: "cmd-input-overflow-2",
      correlation_id: "corr-input-overflow-2",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-overflow",
      terminal_id: terminalId,
      data: "ABCDEFGH",
    });

    const buffer = runtime.getTerminalBuffer(terminalId);
    expect(buffer.total_bytes).toBeLessThanOrEqual(10);
    expect(buffer.dropped_bytes).toBeGreaterThan(0);

    const overflowEvent = runtime
      .getEvents()
      .find(
        event =>
          event.topic === "terminal.output" &&
          event.correlation_id === "corr-input-overflow-2" &&
          event.payload?.overflowed === true
      );
    expect(overflowEvent).toBeDefined();

    const throttledEvent = runtime
      .getEvents()
      .find(
        event =>
          event.topic === "terminal.state.changed" &&
          event.correlation_id === "corr-input-overflow-2" &&
          event.payload?.state === "throttled"
      );
    expect(throttledEvent).toBeDefined();
  });

  test("returns terminal runtime state to active on resize after throttling", async () => {
    const runtime = createRuntime({ terminalBufferCapBytes: 4 });
    const spawn = await runtime.spawnTerminal({
      command_id: "cmd-spawn-recover",
      correlation_id: "corr-spawn-recover",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-recover",
    });
    const terminalId = String(spawn.result?.terminal_id);

    await runtime.inputTerminal({
      command_id: "cmd-input-recover",
      correlation_id: "corr-input-recover",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-recover",
      terminal_id: terminalId,
      data: "12345",
    });
    expect(runtime.getState().terminal).toBe("throttled");

    const resize = await runtime.resizeTerminal({
      command_id: "cmd-resize-recover",
      correlation_id: "corr-resize-recover",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-recover",
      terminal_id: terminalId,
      cols: 120,
      rows: 40,
    });

    expect(resize.status).toBe("ok");
    expect(runtime.getState().terminal).toBe("active");

    const recoveryEvent = runtime
      .getEvents()
      .find(
        event =>
          event.topic === "terminal.state.changed" &&
          event.correlation_id === "corr-resize-recover" &&
          event.payload?.state === "active"
      );

    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent?.payload?.runtime_state).toEqual(runtime.getState());
  });

  test("clears stale buffered output when reusing terminal_id", async () => {
    const runtime = createRuntime({ terminalBufferCapBytes: 1024 });

    const firstSpawn = await runtime.bus.request({
      id: "cmd-spawn-reuse-1",
      type: "command",
      ts: new Date().toISOString(),
      method: "terminal.spawn",
      correlation_id: "corr-spawn-reuse-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-reuse",
      payload: {
        session_id: "sess-reuse",
        terminal_id: "term-reused",
      },
    });
    expect(firstSpawn.status).toBe("ok");

    const firstInput = await runtime.inputTerminal({
      command_id: "cmd-input-reuse-1",
      correlation_id: "corr-input-reuse-1",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-reuse",
      terminal_id: "term-reused",
      data: "first",
    });
    expect(firstInput.status).toBe("ok");
    expect(firstInput.result?.output_seq).toBe(1);
    expect(
      runtime.getTerminalBuffer("term-reused").entries.map((entry: { seq: number }) => entry.seq)
    ).toEqual([1]);

    const secondSpawn = await runtime.bus.request({
      id: "cmd-spawn-reuse-2",
      type: "command",
      ts: new Date().toISOString(),
      method: "terminal.spawn",
      correlation_id: "corr-spawn-reuse-2",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-reuse",
      payload: {
        session_id: "sess-reuse",
        terminal_id: "term-reused",
      },
    });
    expect(secondSpawn.status).toBe("ok");
    expect(runtime.getTerminalBuffer("term-reused").entries).toHaveLength(0);

    const secondInput = await runtime.inputTerminal({
      command_id: "cmd-input-reuse-2",
      correlation_id: "corr-input-reuse-2",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-reuse",
      terminal_id: "term-reused",
      data: "second",
    });
    expect(secondInput.status).toBe("ok");
    expect(secondInput.result?.output_seq).toBe(1);
    expect(
      runtime.getTerminalBuffer("term-reused").entries.map((entry: { seq: number }) => entry.seq)
    ).toEqual([1]);
  });

  test("rejects terminal input when payload.data is missing", async () => {
    const runtime = createRuntime();
    const spawn = await runtime.spawnTerminal({
      command_id: "cmd-spawn-invalid-input",
      correlation_id: "corr-spawn-invalid-input",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-invalid-input",
    });
    const terminalId = String(spawn.result?.terminal_id);

    const response = await runtime.bus.request({
      id: "cmd-input-invalid",
      type: "command",
      ts: new Date().toISOString(),
      method: "terminal.input",
      correlation_id: "corr-input-invalid",
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "sess-invalid-input",
      terminal_id: terminalId,
      payload: {
        terminal_id: terminalId,
        session_id: "sess-invalid-input",
      },
    });

    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("INVALID_TERMINAL_INPUT");
  });
});
