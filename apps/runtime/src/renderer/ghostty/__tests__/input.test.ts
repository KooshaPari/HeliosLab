/**
 * Unit tests for GhosttyInputRelay (T007).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GhosttyInputRelay } from "../input.js";
import type { PtyWriter, GhosttyInputEvent } from "../input.js";
import { GhosttyProcess } from "../process.js";

// ---------------------------------------------------------------------------
// Mock PTY writer
// ---------------------------------------------------------------------------

class MockPtyWriter implements PtyWriter {
  readonly calls: Array<{ ptyId: string; data: Uint8Array }> = [];

  writeInput(ptyId: string, data: Uint8Array): void {
    this.calls.push({ ptyId, data });
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(bytes: number[], timestamp = Date.now()): GhosttyInputEvent {
  return { data: new Uint8Array(bytes), timestamp };
}

describe("GhosttyInputRelay", () => {
  let writer: MockPtyWriter;
  let relay: GhosttyInputRelay;
  let proc: GhosttyProcess;

  beforeEach(() => {
    writer = new MockPtyWriter();
    relay = new GhosttyInputRelay(writer);
    proc = new GhosttyProcess();
  });

  // -----------------------------------------------------------------------
  // Setup / teardown
  // -----------------------------------------------------------------------

  test("setupInputRelay creates a binding", () => {
    relay.setupInputRelay("pty-1", proc);
    expect(relay.hasBinding("pty-1")).toBe(true);
  });

  test("teardownInputRelay removes binding", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.teardownInputRelay("pty-1");
    expect(relay.hasBinding("pty-1")).toBe(false);
  });

  test("teardown unknown pty is a no-op", () => {
    relay.teardownInputRelay("nonexistent"); // Should not throw
  });

  test("teardownAll removes all bindings", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setupInputRelay("pty-2", proc);
    relay.teardownAll();
    expect(relay.getBoundPtyIds()).toEqual([]);
  });

  test("setupInputRelay replaces existing binding", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setupInputRelay("pty-1", proc); // Replace
    expect(relay.getBoundPtyIds()).toEqual(["pty-1"]);
  });

  // -----------------------------------------------------------------------
  // Focus
  // -----------------------------------------------------------------------

  test("focus management", () => {
    expect(relay.getFocusedPtyId()).toBeUndefined();
    relay.setFocus("pty-1");
    expect(relay.getFocusedPtyId()).toBe("pty-1");
    relay.clearFocus();
    expect(relay.getFocusedPtyId()).toBeUndefined();
  });

  test("teardown of focused pty clears focus", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");
    relay.teardownInputRelay("pty-1");
    expect(relay.getFocusedPtyId()).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Input relay
  // -----------------------------------------------------------------------

  test("relayInput sends bytes to focused PTY", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");

    const event = makeEvent([0x41, 0x42, 0x43]); // "ABC"
    relay.relayInput(event);

    expect(writer.calls.length).toBe(1);
    expect(writer.calls[0]?.ptyId).toBe("pty-1");
    expect(writer.calls[0]?.data).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
  });

  test("input bytes reach PTY without modification", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");

    // Escape sequence: ESC [ A (arrow up)
    const escSeq = [0x1b, 0x5b, 0x41];
    relay.relayInput(makeEvent(escSeq));

    expect(writer.calls[0]?.data).toEqual(new Uint8Array(escSeq));
  });

  test("modifier keys and escape sequences preserved", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");

    // Ctrl+C = 0x03
    relay.relayInput(makeEvent([0x03]));
    expect(writer.calls[0]?.data).toEqual(new Uint8Array([0x03]));

    // CSI sequence with modifiers
    const csi = [0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x41]; // Ctrl+Up
    relay.relayInput(makeEvent(csi));
    expect(writer.calls[1]?.data).toEqual(new Uint8Array(csi));
  });

  test("correct PTY targeted based on focus", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setupInputRelay("pty-2", proc);

    relay.setFocus("pty-2");
    relay.relayInput(makeEvent([0x41]));

    expect(writer.calls.length).toBe(1);
    expect(writer.calls[0]?.ptyId).toBe("pty-2");
  });

  test("input discarded when no PTY is focused", () => {
    relay.setupInputRelay("pty-1", proc);
    // No focus set
    relay.relayInput(makeEvent([0x41]));
    expect(writer.calls.length).toBe(0);
  });

  test("input discarded when focused PTY has no binding", () => {
    relay.setFocus("pty-999"); // Not bound
    relay.relayInput(makeEvent([0x41]));
    expect(writer.calls.length).toBe(0);
  });

  test("rapid input (paste) delivered in order", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");

    // Simulate rapid paste
    for (let i = 0; i < 100; i++) {
      relay.relayInput(makeEvent([i % 256]));
    }

    expect(writer.calls.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(writer.calls[i]?.data).toEqual(new Uint8Array([i % 256]));
    }
  });

  // -----------------------------------------------------------------------
  // No buffering / batching verification
  // -----------------------------------------------------------------------

  test("each relayInput immediately calls writeInput (no batching)", () => {
    relay.setupInputRelay("pty-1", proc);
    relay.setFocus("pty-1");

    relay.relayInput(makeEvent([0x41]));
    expect(writer.calls.length).toBe(1);

    relay.relayInput(makeEvent([0x42]));
    expect(writer.calls.length).toBe(2);
  });
});
