/**
 * Integration tests for hot-swap renderer switching.
 *
 * Tests atomicity, byte continuity, and state preservation across
 * hot-swap transitions with multiple active terminals.
 *
 * @see FR-010-009, SC-010-002
 * Traces to: FR-TXN-002 (attempt hot-swap when both renderers support it),
 * FR-TXN-003 (fall back to restart-with-restore when unavailable)
 */

import { describe, expect, it } from "bun:test";
import { executeHotSwap, type TerminalContext } from "../../../src/renderer/hot_swap.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
  TEST_SURFACE,
} from "../../helpers/mock_adapter.js";

describe("Hot-swap integration", () => {
  it("successfully hot-swaps single terminal", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [new Uint8Array([1, 2, 3])],
          cursorX: 10,
          cursorY: 5,
          env: { TERM: "xterm" },
          cwd: "/home/user",
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
      async () => {}
    );

    expect(result.success).toBe(true);
    expect(result.phase).toBe("committed");
    expect(result.preservedContexts.length).toBe(1);
    expect(result.preservedContexts[0]!.ptyId).toBe("pty-1");
  });

  it("successfully hot-swaps multiple terminals", async () => {
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
          env: { PATH: "/usr/bin" },
          cwd: "/tmp",
        },
      ],
      [
        "pty-3",
        {
          ptyId: "pty-3",
          scrollback: [],
          cursorX: 15,
          cursorY: 20,
          env: { HOME: "/home/user" },
          cwd: "/home/user",
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
      async () => {}
    );

    expect(result.success).toBe(true);
    expect(result.preservedContexts.length).toBe(3);
  });

  it("preserves scrollback during hot-swap", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const scrollback = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7]),
      new Uint8Array([8, 9]),
    ];

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback,
          cursorX: 20,
          cursorY: 30,
          env: { TERM: "xterm-256color" },
          cwd: "/home/user/projects",
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
      async () => {}
    );

    expect(result.success).toBe(true);
    const _context = result.preservedContexts[0]!;
    expect(context.scrollback.length).toBe(3);
  });

  it("preserves cursor position during hot-swap", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 42,
          cursorY: 17,
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
      async () => {}
    );

    expect(result.success).toBe(true);
    const _context = result.preservedContexts[0]!;
    expect(context.cursorX).toBe(42);
    expect(context.cursorY).toBe(17);
  });

  it("preserves environment and cwd during hot-swap", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const env = {
      TERM: "xterm-256color",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/user",
      USER: "user",
      SHELL: "/bin/zsh",
    };
    const cwd = "/home/user/projects/myapp/src";

    const terminals = new Map<string, TerminalContext>([
      [
        "pty-1",
        {
          ptyId: "pty-1",
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env,
          cwd,
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
      async () => {}
    );

    expect(result.success).toBe(true);
    const _context = result.preservedContexts[0]!;
    expect(context.env).toEqual(env);
    expect(context.cwd).toBe(cwd);
  });

  it("completes within timing SLO (3 seconds)", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>();
    for (let i = 0; i < 5; i++) {
      terminals.set(`pty-${i}`, {
        ptyId: `pty-${i}`,
        scrollback: [],
        cursorX: 0,
        cursorY: 0,
        env: {},
        cwd: "/",
      });
    }

    const _startTime = Date.now();
    const result = await executeHotSwap(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {}
    );

    const elapsed = Date.now() - startTime;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  });

  it("fails gracefully with zero terminals", async () => {
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter();
    const buffer = new SwitchBuffer();

    const terminals = new Map<string, TerminalContext>();

    const result = await executeHotSwap(
      source,
      target,
      terminals,
      buffer,
      TEST_CONFIG,
      TEST_SURFACE,
      async () => {}
    );

    expect(result.success).toBe(false);
    expect(result.phase).toBe("pre-validation");
  });

  it("triggers rollback on target init failure", async () => {
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
});
