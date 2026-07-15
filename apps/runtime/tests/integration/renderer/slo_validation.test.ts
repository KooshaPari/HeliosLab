/**
 * SLO validation tests for renderer switching.
 *
 * Verifies timing budgets for all switch paths at p95 percentile.
 *
 * @see NFR-010-001, NFR-010-004
 */

import { describe, expect, it } from "bun:test";
import { executeHotSwap } from "../../../src/renderer/hot_swap.js";
import { executeRestartWithRestore } from "../../../src/renderer/restart_restore.js";
import { executeRollback } from "../../../src/renderer/rollback.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
  TEST_SURFACE,
} from "../../helpers/mock_adapter.js";
import type { TerminalContext } from "../../../src/renderer/hot_swap.js";

/**
 * Calculate p95 (95th percentile) of timing values.
 */
function calculateP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
}

describe("SLO validation - hot-swap", () => {
  it("hot-swap SLO: p95 < 3 seconds with single terminal", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
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
      ]);

      const startTime = Date.now();
      await executeHotSwap(
        source,
        target,
        terminals,
        buffer,
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {}
      );
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(3000);
  });

  it("hot-swap SLO: p95 < 3 seconds with 5 terminals", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const source = new MockGhosttyAdapter();
      const target = new MockRioAdapter();
      const buffer = new SwitchBuffer();

      const terminals = new Map<string, TerminalContext>();
      for (let j = 0; j < 5; j++) {
        terminals.set(`pty-${j}`, {
          ptyId: `pty-${j}`,
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        });
      }

      const startTime = Date.now();
      await executeHotSwap(
        source,
        target,
        terminals,
        buffer,
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {}
      );
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(3000);
  });
});

describe("SLO validation - restart-with-restore", () => {
  it("restart-with-restore SLO: p95 < 8 seconds with single terminal", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const source = new MockGhosttyAdapter();
      const target = new MockRioAdapter();
      const buffer = new SwitchBuffer();

      const terminals = new Map<string, TerminalContext>([
        [
          "pty-1",
          {
            ptyId: "pty-1",
            scrollback: [new Uint8Array(100)],
            cursorX: 0,
            cursorY: 0,
            env: {},
            cwd: "/",
          },
        ],
      ]);

      const startTime = Date.now();
      await executeRestartWithRestore(
        source,
        target,
        terminals,
        buffer,
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {}
      );
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(8000);
  });

  it("restart-with-restore SLO: p95 < 8 seconds with 5 terminals", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const source = new MockGhosttyAdapter();
      const target = new MockRioAdapter();
      const buffer = new SwitchBuffer();

      const terminals = new Map<string, TerminalContext>();
      for (let j = 0; j < 5; j++) {
        terminals.set(`pty-${j}`, {
          ptyId: `pty-${j}`,
          scrollback: [new Uint8Array(50)],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        });
      }

      const startTime = Date.now();
      await executeRestartWithRestore(
        source,
        target,
        terminals,
        buffer,
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {}
      );
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(8000);
  });
});

describe("SLO validation - rollback", () => {
  it("rollback SLO: p95 < 5 seconds with single terminal", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
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

      const startTime = Date.now();
      await executeRollback(original, failed, terminals, buffer, "test failure");
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(5000);
  });

  it("rollback SLO: p95 < 5 seconds with 5 terminals", async () => {
    const durations: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const original = new MockGhosttyAdapter();
      const failed = new MockRioAdapter();
      const buffer = new SwitchBuffer();

      const terminals = new Map<string, TerminalContext>();
      for (let j = 0; j < 5; j++) {
        terminals.set(`pty-${j}`, {
          ptyId: `pty-${j}`,
          scrollback: [],
          cursorX: 0,
          cursorY: 0,
          env: {},
          cwd: "/",
        });
      }

      const startTime = Date.now();
      await executeRollback(original, failed, terminals, buffer, "test failure");
      durations.push(Date.now() - startTime);
    }

    const p95 = calculateP95(durations);
    expect(p95).toBeLessThan(5000);
  });
});
