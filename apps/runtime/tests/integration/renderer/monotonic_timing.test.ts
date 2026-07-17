import { describe, expect, it } from "bun:test";

import type { MonotonicClock } from "../../../src/diagnostics/hooks.js";
import { executeHotSwap, type TerminalContext } from "../../../src/renderer/hot_swap.js";
import { executeRestartWithRestore } from "../../../src/renderer/restart_restore.js";
import { executeRollback } from "../../../src/renderer/rollback.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
  TEST_SURFACE,
} from "../../helpers/mock_adapter.js";

function sequenceClock(start: number, end: number): MonotonicClock {
  const timestamps = [start, end];
  return {
    now(): number {
      const timestamp = timestamps.shift();
      if (timestamp === undefined) throw new Error("Monotonic clock sequence exhausted");
      return timestamp;
    },
  };
}

function terminalContexts(): Map<string, TerminalContext> {
  return new Map([
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
}

async function withRollingBackWallClock(run: () => Promise<void>): Promise<void> {
  const originalDateNow = Date.now;
  let wallTime = 1_000;
  Date.now = () => --wallTime;
  try {
    await run();
  } finally {
    Date.now = originalDateNow;
  }
}

describe("renderer switch monotonic timing", () => {
  it("measures hot-swap duration when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const result = await executeHotSwap(
        new MockGhosttyAdapter(),
        new MockRioAdapter(),
        terminalContexts(),
        new SwitchBuffer(),
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {},
        undefined,
        sequenceClock(100, 107)
      );
      expect(result.durationMs).toBe(7);
    });
  });

  it("measures rollback duration when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const result = await executeRollback(
        new MockGhosttyAdapter(),
        new MockRioAdapter(),
        terminalContexts(),
        new SwitchBuffer(),
        "target failed",
        undefined,
        sequenceClock(200, 211)
      );
      expect(result.durationMs).toBe(11);
    });
  });

  it("measures restart-restore duration when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const result = await executeRestartWithRestore(
        new MockGhosttyAdapter(),
        new MockRioAdapter(),
        terminalContexts(),
        new SwitchBuffer(),
        TEST_CONFIG,
        TEST_SURFACE,
        async () => {},
        undefined,
        sequenceClock(300, 313)
      );
      expect(result.durationMs).toBe(13);
    });
  });
});
