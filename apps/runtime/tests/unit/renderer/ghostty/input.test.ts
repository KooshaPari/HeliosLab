/**
 * FR-HELIOS-048: Ghostty Input Relay Tests
 * Verifies: FR-GHT-003 (PTY stream piping), FR-RND-005 (PTY stream binding)
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { GhosttyInputRelay } from "../../../../src/renderer/ghostty/input.js";
import type { PtyWriter, GhosttyInputEvent } from "../../../../src/renderer/ghostty/input.js";
import { GhosttyProcess } from "../../../../src/renderer/ghostty/process.js";
import { GhosttyMetrics } from "../../../../src/renderer/ghostty/metrics.js";

function makeEvent(data: number[]): GhosttyInputEvent {
  return {
    data: new Uint8Array(data),
    timestamp: Date.now(),
  };
}

describe("GhosttyInputRelay - focus management", () => {
  let relay: GhosttyInputRelay;
  const writes: Array<{ ptyId: string; data: Uint8Array }> = [];
  const writer: PtyWriter = {
    writeInput(ptyId, data) {
      writes.push({ ptyId, data });
    },
  };

  beforeEach(() => {
    writes.length = 0;
    relay = new GhosttyInputRelay(writer);
  });

  test("initially no focus", () => {
    expect(relay.getFocusedPtyId()).toBeUndefined();
  });

  test("setFocus / clearFocus", () => {
    relay.setFocus("pty-1");
    expect(relay.getFocusedPtyId()).toBe("pty-1");
    relay.clearFocus();
    expect(relay.getFocusedPtyId()).toBeUndefined();
  });

  test("input discarded when no focus", () => {
    relay.relayInput(makeEvent([0x41]));
    expect(writes.length).toBe(0);
  });

  test("input discarded when focused PTY has no binding", () => {
    relay.setFocus("pty-1");
    relay.relayInput(makeEvent([0x41]));
    expect(writes.length).toBe(0);
  });
});

describe("GhosttyInputRelay - binding lifecycle", () => {
  let relay: GhosttyInputRelay;
  const writes: Array<{ ptyId: string; data: Uint8Array }> = [];
  const writer: PtyWriter = {
    writeInput(ptyId, data) {
      writes.push({ ptyId, data });
    },
  };
  let ghosttyProcess: GhosttyProcess;

  beforeEach(() => {
    writes.length = 0;
    relay = new GhosttyInputRelay(writer);
    ghosttyProcess = new GhosttyProcess();
  });

  test("setupInputRelay creates binding", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    expect(relay.hasBinding("pty-1")).toBe(true);
    expect(relay.getBoundPtyIds()).toEqual(["pty-1"]);
  });

  test("teardownInputRelay removes binding", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.teardownInputRelay("pty-1");
    expect(relay.hasBinding("pty-1")).toBe(false);
  });

  test("teardown focused PTY clears focus", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setFocus("pty-1");
    relay.teardownInputRelay("pty-1");
    expect(relay.getFocusedPtyId()).toBeUndefined();
  });

  test("teardownAll clears all bindings", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setupInputRelay("pty-2", ghosttyProcess);
    relay.teardownAll();
    expect(relay.getBoundPtyIds()).toEqual([]);
  });

  test("rebind replaces existing binding", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setupInputRelay("pty-1", ghosttyProcess);
    expect(relay.getBoundPtyIds()).toEqual(["pty-1"]);
  });

  test("teardown unknown PTY is a no-op", () => {
    relay.teardownInputRelay("nonexistent");
    expect(relay.getBoundPtyIds()).toEqual([]);
  });
});

describe("GhosttyInputRelay - byte passthrough", () => {
  let relay: GhosttyInputRelay;
  const writes: Array<{ ptyId: string; data: Uint8Array }> = [];
  const writer: PtyWriter = {
    writeInput(ptyId, data) {
      writes.push({ ptyId, data });
    },
  };
  let ghosttyProcess: GhosttyProcess;

  beforeEach(() => {
    writes.length = 0;
    relay = new GhosttyInputRelay(writer);
    ghosttyProcess = new GhosttyProcess();
  });

  test("relayInput routes to focused PTY", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setFocus("pty-1");
    relay.relayInput(makeEvent([0x41, 0x42, 0x43]));
    expect(writes.length).toBe(1);
    expect(writes[0]!.ptyId).toBe("pty-1");
    expect(writes[0]!.data).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
  });

  test("input not routed to unfocused PTY", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setupInputRelay("pty-2", ghosttyProcess);
    relay.setFocus("pty-1");
    relay.relayInput(makeEvent([0x41]));
    // Only pty-1 receives input
    expect(writes.length).toBe(1);
    expect(writes[0]!.ptyId).toBe("pty-1");
  });

  test("focus switch routes input to new target", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setupInputRelay("pty-2", ghosttyProcess);

    relay.setFocus("pty-1");
    relay.relayInput(makeEvent([0x41]));

    relay.setFocus("pty-2");
    relay.relayInput(makeEvent([0x42]));

    expect(writes.length).toBe(2);
    expect(writes[0]!.ptyId).toBe("pty-1");
    expect(writes[1]!.ptyId).toBe("pty-2");
  });

  test("escape sequences pass through unmodified", () => {
    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setFocus("pty-1");
    // ESC [ A = cursor up
    relay.relayInput(makeEvent([0x1b, 0x5b, 0x41]));
    expect(writes[0]!.data).toEqual(new Uint8Array([0x1b, 0x5b, 0x41]));
  });
});

describe("GhosttyInputRelay - metrics integration", () => {
  test("records input latency when metrics provided", () => {
    const metrics = new GhosttyMetrics({ publishIntervalMs: 0 });
    metrics.enable();

    const writes: Array<{ ptyId: string; data: Uint8Array }> = [];
    const writer: PtyWriter = {
      writeInput(ptyId, data) {
        writes.push({ ptyId, data });
      },
    };
    const relay = new GhosttyInputRelay(writer, metrics);
    const ghosttyProcess = new GhosttyProcess();

    relay.setupInputRelay("pty-1", ghosttyProcess);
    relay.setFocus("pty-1");
    relay.relayInput({
      data: new Uint8Array([0x41]),
      timestamp: Date.now() - 10,
    });

    const snap = metrics.getSnapshot();
    // Input latency should have been recorded
    expect(snap.p50InputLatency).toBeGreaterThanOrEqual(0);
  });
});
