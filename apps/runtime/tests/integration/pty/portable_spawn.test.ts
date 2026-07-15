import { describe, expect, it } from "bun:test";
import { InMemoryBusPublisher, PtyManager } from "../../../src/pty/index.js";

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("portable real PTY process integration", () => {
  it("spawns the platform shell and reads command output through PtyManager", async () => {
    const bus = new InMemoryBusPublisher();
    const manager = new PtyManager(4, bus);
    const shell =
      process.platform === "win32"
        ? (process.env.ComSpec ?? "cmd.exe")
        : (process.env.SHELL ?? "/bin/sh");
    const newline = process.platform === "win32" ? "\r\n" : "\n";
    const record = await manager.spawn({
      shell,
      laneId: "lane-real",
      sessionId: "session-real",
      terminalId: "terminal-real",
    });

    try {
      manager.writeInput(
        record.ptyId,
        new TextEncoder().encode(`echo HELIOS_REAL_PTY${newline}exit${newline}`)
      );
      await waitFor(() => (manager.getBufferStats(record.ptyId)?.currentSize ?? 0) > 0);

      const output = new TextDecoder().decode(manager.readOutput(record.ptyId));
      expect(output).toContain("HELIOS_REAL_PTY");
      expect(bus.events.some(event => event.topic === "pty.output")).toBe(true);
    } finally {
      await manager.terminate(record.ptyId, { gracePeriodMs: 100 });
    }
  });
});
