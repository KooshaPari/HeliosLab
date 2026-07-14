/**
 * Fault injection tests for renderer switching.
 *
 * Tests all failure modes and verifies clean rollback or safe degraded mode.
 *
 * @see FR-010-011, FR-010-012, SC-010-004
 */

import { describe, expect, it } from "bun:test";
import { executeHotSwap } from "../../../src/renderer/hot_swap.js";
import { executeRollback } from "../../../src/renderer/rollback.js";
import { executeRestartWithRestore } from "../../../src/renderer/restart_restore.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
  TEST_SURFACE,
} from "../../helpers/mock_adapter.js";
import type { TerminalContext } from "../../../src/renderer/hot_swap.js";

describe("Fault injection - hot-swap failures", () => {
  it("target renderer init failure triggers rollback", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initFail: true });
    const buffer = new SwitchBuffer();
    let rollbackCalled = false;

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeHotSwap(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {
        rollbackCalled = true;
      }
    );

    expect(result.success).toBe(false);
    expect(rollbackCalled).toBe(true);
  });

  it("target renderer start failure triggers rollback", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ startFail: true });
    const buffer = new SwitchBuffer();
    let rollbackCalled = false;

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeHotSwap(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {
        rollbackCalled = true;
      }
    );

    expect(result.success).toBe(false);
    expect(rollbackCalled).toBe(true);
  });
});

describe("Fault injection - restart-with-restore failures", () => {
  it("checkpoint phase succeeds", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [new Uint8Array([1, 2])],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeRestartWithRestore(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {}
    );

    expect(result.success).toBe(true);
    expect(result.checkpoints.length).toBe(1);
    expect(result.checkpoints[0]!.ptyId).toBe("pty-1");
  });

  it("target renderer init failure during restart triggers rollback", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initFail: true });
    const buffer = new SwitchBuffer();
    let rollbackCalled = false;

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeRestartWithRestore(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {
        rollbackCalled = true;
      }
    );

    expect(result.success).toBe(false);
    expect(rollbackCalled).toBe(true);
  });

  it("restore phase handles all terminals", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
      [
        "pty-2",
        {
          ptyId: "pty-2",
          scrollback: [],
          cursorX: 5,
          cursorY: 10,
          env: {},
          cwd: "/",
        },
      ],
      [
        "pty-3",
        {
          ptyId: "pty-3",
          scrollback: [],
          cursorX: 15,
          cursorY: 20,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeRestartWithRestore(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {}
    );

    expect(result.success).toBe(true);
    expect(result.checkpoints.length).toBe(3);
  });
});

describe("Fault injection - rollback handling", () => {
  it("rollback restores all terminals after failure", async () => {
    const original = new MockGhosttyAdapter();
    const failed = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
      [
        "pty-2",
        {
          ptyId: "pty-2",
          scrollback: [],
          cursorX: 5,
          cursorY: 10,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const result = await executeRollback(original, failed, terminals, buffer, "test failure");

    expect(result.success).toBe(true);
    expect(result.terminalStatuses.length).toBe(2);
    for (const status of result.terminalStatuses) {
      expect(status.restored).toBe(true);
      expect(status.degraded).toBe(false);
    }
  });

  it("rollback includes failure reason", async () => {
    const original = new MockGhosttyAdapter();
    const failed = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        },
      ],
    ]);

    const failureReason = "target renderer GPU allocation failed";

    const result = await executeRollback(original, failed, terminals, buffer, failureReason);

    expect(result.failureReason).toBe(failureReason);
  });
});

describe("Fault injection - buffer overflow handling", () => {
  it("buffer overflow emits telemetry event", async () => {
    let overflowEventCount = 0;

    const mockBus = {
      publish: () => {
        overflowEventCount++;
      },
    };

    const buffer = new SwitchBuffer(10, mockBus); // 10 byte limit with bus

    buffer.startBuffering();
    buffer.write("pty-1", new Uint8Array(6));
    buffer.write("pty-1", new Uint8Array(6)); // Should trigger overflow

    expect(overflowEventCount).toBeGreaterThan(0);
  });

  it("buffer still captures data after overflow", async () => {
    const buffer = new SwitchBuffer(10);
    const _renderer = new MockGhosttyAdapter();

    buffer.startBuffering();
    buffer.write("pty-1", new Uint8Array(6));
    buffer.write("pty-1", new Uint8Array(6)); // Exceeds limit
    buffer.write("pty-1", new Uint8Array(3)); // Should still capture

    expect(buffer.getBufferedBytes()).toBeLessThanOrEqual(10);
    expect(buffer.getBufferedBytes()).toBeGreaterThan(0);
  });
});
