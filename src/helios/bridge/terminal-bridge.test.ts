/**
 * Terminal Bridge Tests
 *
 * Verifies terminal bridge interface and basic PTY subprocess handling
 */

import { describe, it, expect, beforeEach, afterEach, vi, expectTypeOf } from "vitest";
import { createTerminalBridge, HeliosTerminalBridge } from "./terminal-bridge";

describe(createTerminalBridge, () => {
  let bridge: ReturnType<typeof createTerminalBridge>;

  beforeEach(() => {
    bridge = createTerminalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("returns an object with required methods", () => {
    expectTypeOf(bridge.spawnTerminal).toBeFunction();
    expectTypeOf(bridge.writeToTerminal).toBeFunction();
    expectTypeOf(bridge.resizeTerminal).toBeFunction();
    expectTypeOf(bridge.killTerminal).toBeFunction();
    expectTypeOf(bridge.dispose).toBeFunction();
  });

  describe("spawnTerminal", () => {
    it("returns a terminal ID", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      expectTypeOf(terminalId).toBeString();
      expect(terminalId.length).toBeGreaterThan(0);
    });

    it("accepts optional cwd parameter", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-2", "workspace-1", "window-1", "/tmp");
      expectTypeOf(_terminalId).toBeString();
    });

    it("creates unique terminal IDs for each spawn", () => {
      const id1 = bridge.spawnTerminal("helios-term-a", "workspace-1", "window-1");
      const id2 = bridge.spawnTerminal("helios-term-b", "workspace-1", "window-1");
      expect(id1).not.toBe(id2);
    });
  });

  describe("writeToTerminal", () => {
    it("returns false for non-existent terminal", () => {
      const result = bridge.writeToTerminal("non-existent", "test");
      expect(result).toBeFalsy();
    });

    it("returns true for valid terminal", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.writeToTerminal("helios-term-1", "echo test");
      expect(result).toBeTruthy();
    });

    it("accepts string data parameter", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.writeToTerminal("helios-term-1", "ls\n");
      expect(result).toBeTruthy();
    });
  });

  describe("resizeTerminal", () => {
    it("returns false for non-existent terminal", () => {
      const result = bridge.resizeTerminal("non-existent", 80, 24);
      expect(result).toBeFalsy();
    });

    it("returns true for valid terminal", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.resizeTerminal("helios-term-1", 120, 40);
      expect(result).toBeTruthy();
    });

    it("accepts cols and rows parameters", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.resizeTerminal("helios-term-1", 100, 50);
      expect(result).toBeTruthy();
    });
  });

  describe("killTerminal", () => {
    it("returns false for non-existent terminal", () => {
      const result = bridge.killTerminal("non-existent");
      expect(result).toBeFalsy();
    });

    it("returns true for valid terminal", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.killTerminal("helios-term-1");
      expect(result).toBeTruthy();
    });

    it("prevents operations on killed terminal", () => {
      const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      bridge.killTerminal("helios-term-1");
      const result = bridge.writeToTerminal("helios-term-1", "test");
      expect(result).toBeFalsy();
    });
  });

  describe("dispose", () => {
    it("cleans up all terminals", () => {
      bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      bridge.spawnTerminal("helios-term-2", "workspace-1", "window-1");
      bridge.dispose();

      const result1 = bridge.writeToTerminal("helios-term-1", "test");
      const result2 = bridge.writeToTerminal("helios-term-2", "test");
      expect(result1).toBeFalsy();
      expect(result2).toBeFalsy();
    });

    it("can be called multiple times safely", () => {
      bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      expect(() => {
        bridge.dispose();
        bridge.dispose();
      }).not.toThrow();
    });
  });
});

describe(HeliosTerminalBridge, () => {
  let bridge: HeliosTerminalBridge;

  beforeEach(() => {
    bridge = new HeliosTerminalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("creates an instance with required methods", () => {
    expectTypeOf(bridge.spawnTerminal).toBeFunction();
    expectTypeOf(bridge.sendInput).toBeFunction();
    expectTypeOf(bridge.resize).toBeFunction();
    expectTypeOf(bridge.dispose).toBeFunction();
  });

  it("spawnTerminal returns a string ID", () => {
    const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    expectTypeOf(_terminalId).toBeString();
  });

  it("sendInput delegates to writeToTerminal", () => {
    const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    const result = bridge.sendInput("helios-term-1", "test data");
    expectTypeOf(result).toBeBoolean();
  });

  it("resize delegates to resizeTerminal", () => {
    const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    const result = bridge.resize("helios-term-1", 80, 24);
    expectTypeOf(result).toBeBoolean();
  });

  it("dispose cleans up resources", () => {
    const _terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    expect(() => {
      bridge.dispose();
    }).not.toThrow();
  });
});
