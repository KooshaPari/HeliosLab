import { describe, expect, it } from "bun:test";
import { writeInput, InvalidStateError } from "../io.js";
import type { ProcessMap } from "../io.js";
import type { PtyRecord } from "../registry.js";
import { InMemoryBusPublisher } from "../events.js";

function makeRecord(overrides?: Partial<PtyRecord>): PtyRecord {
  return {
    ptyId: "pty-io-1",
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    pid: 12345,
    state: "active",
    dimensions: { cols: 80, rows: 24 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    env: Object.freeze({}),
    ...overrides,
  };
}

function makeMockProcess(): {
  proc: { readonly stdin: { write(data: Uint8Array | string): number } };
  written: Uint8Array[];
} {
  const written: Uint8Array[] = [];
  const proc = {
    stdin: {
      write(data: Uint8Array | string): number {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        written.push(bytes);
        return bytes.length;
      },
    },
  };
  return { proc, written };
}

// Traces to: FR-PTY-003 (write-input, read-output operations)
describe("writeInput", () => {
  it("writes data to the process stdin", () => {
    const _record = makeRecord();
    const { proc, written } = makeMockProcess();
    const processMap: ProcessMap = new Map();
    processMap.set(record.ptyId, proc);
    const bus = new InMemoryBusPublisher();

    const result = writeInput(record, new Uint8Array([65, 66, 67]), processMap, bus);

    expect(result.bytesWritten).toBe(3);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual(new Uint8Array([65, 66, 67]));
  });

  it("zero-length write is a no-op", () => {
    const _record = makeRecord();
    const processMap: ProcessMap = new Map();
    const bus = new InMemoryBusPublisher();

    const result = writeInput(record, new Uint8Array(0), processMap, bus);
    expect(result.bytesWritten).toBe(0);
  });

  it("rejects writes to non-active PTY", () => {
    const _record = makeRecord({ state: "stopped" });
    const processMap: ProcessMap = new Map();
    const bus = new InMemoryBusPublisher();

    expect(() => writeInput(record, new Uint8Array([65]), processMap, bus)).toThrow(
      InvalidStateError
    );
  });

  it("rejects writes to spawning PTY", () => {
    const _record = makeRecord({ state: "spawning" });
    const processMap: ProcessMap = new Map();
    const bus = new InMemoryBusPublisher();

    expect(() => writeInput(record, new Uint8Array([65]), processMap, bus)).toThrow(
      InvalidStateError
    );
  });

  it("allows writes to throttled PTY", () => {
    const _record = makeRecord({ state: "throttled" });
    const { proc, written } = makeMockProcess();
    const processMap: ProcessMap = new Map();
    processMap.set(record.ptyId, proc);
    const bus = new InMemoryBusPublisher();

    const result = writeInput(record, new Uint8Array([65]), processMap, bus);
    expect(result.bytesWritten).toBe(1);
    expect(written).toHaveLength(1);
  });

  it("calls onError and emits event on write failure", () => {
    const _record = makeRecord();
    const processMap: ProcessMap = new Map();
    const errorProc = {
      stdin: {
        write(_data: Uint8Array | string): number {
          throw new Error("Broken pipe");
        },
      },
    };
    processMap.set(record.ptyId, errorProc);
    const bus = new InMemoryBusPublisher();
    let errorCalled = false;

    expect(() =>
      writeInput(record, new Uint8Array([65]), processMap, bus, () => {
        errorCalled = true;
      })
    ).toThrow("Broken pipe");

    expect(errorCalled).toBe(true);
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]!.topic).toBe("pty.error");
  });
});
