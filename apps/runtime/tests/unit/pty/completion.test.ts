import { describe, expect, it } from "bun:test";
import {
  InMemoryBusPublisher,
  PtyLifecycle,
  PtyManager,
  type PtyRecord,
  type PtySpawnFn,
  resize,
  sendSighup,
  terminate,
} from "../../../src/pty/index.js";

function outputStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe("PTY completion contracts", () => {
  it("retains the spawned process, writes input, buffers output, and emits output events", async () => {
    const writes: string[] = [];
    const spawnFn: PtySpawnFn = () => ({
      pid: 41001,
      stdin: {
        write(data) {
          writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
          return typeof data === "string" ? data.length : data.byteLength;
        },
      },
      stdout: outputStream("stdout-marker\n"),
      stderr: outputStream("stderr-marker\n"),
      exited: Promise.resolve(0),
      kill() {},
    });
    const bus = new InMemoryBusPublisher();
    const manager = new PtyManager(10, bus, undefined, undefined, spawnFn);

    const record = await manager.spawn({
      shell: "deterministic-shell",
      laneId: "lane-output",
      sessionId: "session-output",
      terminalId: "terminal-output",
    });
    manager.writeInput(record.ptyId, new TextEncoder().encode("input-marker\n"));
    await waitFor(() => bus.events.filter(event => event.topic === "pty.output").length === 2);

    const output = new TextDecoder().decode(manager.readOutput(record.ptyId));
    expect(output).toContain("stdout-marker");
    expect(output).toContain("stderr-marker");
    expect(writes).toEqual(["input-marker\n"]);
    expect(bus.events.map(event => event.topic)).toEqual(
      expect.arrayContaining(["pty.spawned", "pty.state.changed", "pty.output"])
    );
  });

  it("delivers WINCH, HUP, TERM, and KILL through a platform adapter", async () => {
    const bus = new InMemoryBusPublisher();
    const manager = new PtyManager(300, bus);
    const record: PtyRecord = {
      ptyId: "pty-signals",
      laneId: "lane-signals",
      sessionId: "session-signals",
      terminalId: "terminal-signals",
      pid: 42002,
      state: "active",
      dimensions: { cols: 80, rows: 24 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      env: {},
    };
    manager.registry.register(record);
    const delivered: Array<NodeJS.Signals | 0> = [];
    const sendSignal = (_pid: number, signal: NodeJS.Signals | 0): void => {
      delivered.push(signal);
    };

    resize(record, 120, 40, manager.registry, new Map(), manager.bus, sendSignal);
    sendSighup(record, new Map(), manager.bus, sendSignal);
    await terminate(
      record,
      new PtyLifecycle(record.ptyId, "active"),
      manager.registry,
      new Map(),
      manager.bus,
      { gracePeriodMs: 1 },
      () => true,
      async () => false,
      sendSignal
    );

    expect(delivered).toEqual(["SIGWINCH", "SIGHUP", "SIGTERM", "SIGKILL"]);
    expect(manager.registry.get(record.ptyId)).toBeUndefined();
    expect(bus.events.map(event => event.topic)).toEqual(
      expect.arrayContaining([
        "pty.signal.delivered",
        "pty.resized",
        "pty.terminating",
        "pty.force_killed",
        "pty.stopped",
      ])
    );
  });

  it("reconciles tracked, orphaned, and failed candidates on startup", async () => {
    const manager = new PtyManager();
    manager.registry.register({
      ptyId: "pty-tracked",
      laneId: "lane-tracked",
      sessionId: "session-tracked",
      terminalId: "terminal-tracked",
      pid: 43003,
      state: "active",
      dimensions: { cols: 80, rows: 24 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      env: {},
    });
    const terminated: Array<{ pid: number; gracePeriodMs: number }> = [];

    const result = await manager.reconcileOrphans({
      gracePeriodMs: 17,
      dependencies: {
        scan: async () => [43003, 43004, 43005],
        terminate: async (pid, gracePeriodMs) => {
          terminated.push({ pid, gracePeriodMs });
          if (pid === 43005) throw new Error("access denied");
        },
      },
    });

    expect(result).toMatchObject({ found: 3, reattached: 1, terminated: 1, errors: 1 });
    expect(terminated).toEqual([
      { pid: 43004, gracePeriodMs: 17 },
      { pid: 43005, gracePeriodMs: 17 },
    ]);
  });
});
