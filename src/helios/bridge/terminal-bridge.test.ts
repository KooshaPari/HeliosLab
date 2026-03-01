/**
 * Terminal Bridge Tests
 *
 * Verifies terminal bridge interface and basic PTY subprocess handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTerminalBridge, HeliosTerminalBridge } from "./terminal-bridge";

describe("createTerminalBridge", () => {
  let bridge: ReturnType<typeof createTerminalBridge>;

  beforeEach(() => {
    bridge = createTerminalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("returns an object with required methods", () => {
    expect(typeof bridge.spawnTerminal).toBe("function");
    expect(typeof bridge.writeToTerminal).toBe("function");
    expect(typeof bridge.resizeTerminal).toBe("function");
    expect(typeof bridge.killTerminal).toBe("function");
    expect(typeof bridge.dispose).toBe("function");
  });

  describe("spawnTerminal", () => {
    it("returns a terminal ID", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      expect(typeof terminalId).toBe("string");
      expect(terminalId.length).toBeGreaterThan(0);
    });

    it("accepts optional cwd parameter", () => {
      const terminalId = bridge.spawnTerminal("helios-term-2", "workspace-1", "window-1", "/tmp");
      expect(typeof terminalId).toBe("string");
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
      expect(result).toBe(false);
    });

    it("returns true for valid terminal", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.writeToTerminal("helios-term-1", "echo test");
      expect(result).toBe(true);
    });

    it("accepts string data parameter", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.writeToTerminal("helios-term-1", "ls\n");
      expect(result).toBe(true);
    });
  });

  describe("resizeTerminal", () => {
    it("returns false for non-existent terminal", () => {
      const result = bridge.resizeTerminal("non-existent", 80, 24);
      expect(result).toBe(false);
    });

    it("returns true for valid terminal", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.resizeTerminal("helios-term-1", 120, 40);
      expect(result).toBe(true);
    });

    it("accepts cols and rows parameters", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.resizeTerminal("helios-term-1", 100, 50);
      expect(result).toBe(true);
    });
  });

  describe("killTerminal", () => {
    it("returns false for non-existent terminal", () => {
      const result = bridge.killTerminal("non-existent");
      expect(result).toBe(false);
    });

    it("returns true for valid terminal", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      const result = bridge.killTerminal("helios-term-1");
      expect(result).toBe(true);
    });

    it("prevents operations on killed terminal", () => {
      const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      bridge.killTerminal("helios-term-1");
      const result = bridge.writeToTerminal("helios-term-1", "test");
      expect(result).toBe(false);
    });
  });

  describe("dispose", () => {
    it("cleans up all terminals", () => {
      bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
      bridge.spawnTerminal("helios-term-2", "workspace-1", "window-1");
      bridge.dispose();

      const result1 = bridge.writeToTerminal("helios-term-1", "test");
      const result2 = bridge.writeToTerminal("helios-term-2", "test");
      expect(result1).toBe(false);
      expect(result2).toBe(false);
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

describe("HeliosTerminalBridge", () => {
  let bridge: HeliosTerminalBridge;

  beforeEach(() => {
    bridge = new HeliosTerminalBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("creates an instance with required methods", () => {
    expect(typeof bridge.spawnTerminal).toBe("function");
    expect(typeof bridge.sendInput).toBe("function");
    expect(typeof bridge.resize).toBe("function");
    expect(typeof bridge.dispose).toBe("function");
  });

  it("spawnTerminal returns a string ID", () => {
    const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    expect(typeof terminalId).toBe("string");
  });

  it("sendInput delegates to writeToTerminal", () => {
    const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    const result = bridge.sendInput("helios-term-1", "test data");
    expect(typeof result).toBe("boolean");
  });

  it("resize delegates to resizeTerminal", () => {
    const terminalId = bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    const result = bridge.resize("helios-term-1", 80, 24);
    expect(typeof result).toBe("boolean");
  });

  it("dispose cleans up resources", () => {
    bridge.spawnTerminal("helios-term-1", "workspace-1", "window-1");
    expect(() => {
      bridge.dispose();
    }).not.toThrow();
  });
});
