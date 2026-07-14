/**
 * Integration tests for concurrent switch rejection.
 *
 * Tests that multiple simultaneous switch requests are properly rejected,
 * and that sequential switches are allowed after completion.
 *
 * @see FR-010-008, SC-010-002
 */

import { describe, expect, it } from "bun:test";
import {
  createSwitchOrchestrator,
  ConcurrentSwitchError,
} from "../../../src/renderer/switch_transaction.js";
import { SwitchBuffer } from "../../../src/renderer/stream_binding.js";
import {
  MockGhosttyAdapter,
  MockRioAdapter,
  TEST_CONFIG,
  TEST_SURFACE,
} from "../../helpers/mock_adapter.js";
import type { TerminalContext } from "../../../src/renderer/hot_swap.js";

describe("Concurrent switch rejection", () => {
  it("rejects concurrent switch with error details", async () => {
    const orchestrator = createSwitchOrchestrator();
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initDelay: 500 }); // Slow init to allow second attempt
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

    // Start first switch (will be slow)
    const firstSwitchPromise = orchestrator.startSwitch({
      targetRendererId: target.id,
      sourceAdapter: source,
      targetAdapter: target,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    // Immediately try to start second switch (should fail)
    try {
      await orchestrator.startSwitch({
        targetRendererId: target.id,
        sourceAdapter: source,
        targetAdapter: target,
        terminals,
        streamBuffer: buffer,
        config: TEST_CONFIG,
        surface: TEST_SURFACE,
      });
      expect.unreachable("Should have thrown ConcurrentSwitchError");
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      expect(error).toBeInstanceOf(ConcurrentSwitchError);
      if (error instanceof ConcurrentSwitchError) {
        expect(error.message).toContain("already active");
      }
    }

    // Wait for first switch to complete
    await firstSwitchPromise;
  });

  it("rejects concurrent switch with active transaction details", async () => {
    const orchestrator = createSwitchOrchestrator();
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initDelay: 200 });
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

    const firstSwitchPromise = orchestrator.startSwitch({
      targetRendererId: target.id,
      sourceAdapter: source,
      targetAdapter: target,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    // Try to start second switch
    try {
      await orchestrator.startSwitch({
        targetRendererId: target.id,
        sourceAdapter: source,
        targetAdapter: target,
        terminals,
        streamBuffer: buffer,
        config: TEST_CONFIG,
        surface: TEST_SURFACE,
      });
      expect.unreachable("Should have thrown ConcurrentSwitchError");
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      if (error instanceof ConcurrentSwitchError) {
        const activeTransaction = orchestrator.getActiveTransaction();
        expect(activeTransaction).toBeDefined();
        expect(activeTransaction?.id).toMatch(/^[\da-f-]+$/);
      }
    }

    await firstSwitchPromise;
  });

  it("allows sequential switches after completion", async () => {
    const orchestrator = createSwitchOrchestrator();
    const _ghostty = new MockGhosttyAdapter();
    const rio = new MockRioAdapter();
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

    // First switch: ghostty -> rio
    const result1 = await orchestrator.startSwitch({
      targetRendererId: rio.id,
      sourceAdapter: ghostty,
      targetAdapter: rio,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    expect(result1.state).toBe("committed");
    expect(orchestrator.isSwitchInProgress()).toBe(false);

    // Second switch: rio -> ghostty (sequential, should succeed)
    const result2 = await orchestrator.startSwitch({
      targetRendererId: ghostty.id,
      sourceAdapter: rio,
      targetAdapter: ghostty,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    expect(result2.state).toBe("committed");
    expect(orchestrator.isSwitchInProgress()).toBe(false);
  });

  it("tracks concurrent switch guard state correctly", async () => {
    const orchestrator = createSwitchOrchestrator();
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initDelay: 300 });
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

    // Initially, no switch in progress
    expect(orchestrator.isSwitchInProgress()).toBe(false);

    const switchPromise = orchestrator.startSwitch({
      targetRendererId: target.id,
      sourceAdapter: source,
      targetAdapter: target,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    // During switch, should report in progress
    expect(orchestrator.isSwitchInProgress()).toBe(true);

    // Complete the switch
    await switchPromise;

    // After completion, should report not in progress
    expect(orchestrator.isSwitchInProgress()).toBe(false);
  });

  it("rejects second switch with unique transaction IDs", async () => {
    const orchestrator = createSwitchOrchestrator();
    const source = new MockGhosttyAdapter();
    const target = new MockRioAdapter({ initDelay: 200 });
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

    const firstSwitch = orchestrator.startSwitch({
      targetRendererId: target.id,
      sourceAdapter: source,
      targetAdapter: target,
      terminals,
      streamBuffer: buffer,
      config: TEST_CONFIG,
      surface: TEST_SURFACE,
    });

    const activeTransaction1 = orchestrator.getActiveTransaction();
    expect(activeTransaction1).toBeDefined();

    try {
      await orchestrator.startSwitch({
        targetRendererId: target.id,
        sourceAdapter: source,
        targetAdapter: target,
        terminals,
        streamBuffer: buffer,
        config: TEST_CONFIG,
        surface: TEST_SURFACE,
      });
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      const activeTransaction2 = orchestrator.getActiveTransaction();
      expect(activeTransaction2?.id).toBe(activeTransaction1?.id);
    }

    await firstSwitch;
  });
});
