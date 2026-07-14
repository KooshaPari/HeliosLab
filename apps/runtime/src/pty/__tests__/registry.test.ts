import { describe, expect, it, beforeEach } from "bun:test";
import {
  PtyRegistry,
  DuplicatePtyError,
  RegistryCapacityError,
  type PtyRecord,
} from "../registry.js";

function makeRecord(overrides: Partial<PtyRecord> = {}): PtyRecord {
  const now = Date.now();
  return {
    ptyId: overrides.ptyId ?? "pty-1",
    laneId: overrides.laneId ?? "lane-1",
    sessionId: overrides.sessionId ?? "session-1",
    terminalId: overrides.terminalId ?? "term-1",
    pid: overrides.pid ?? 1234,
    state: overrides.state ?? "active",
    dimensions: overrides.dimensions ?? { cols: 80, rows: 24 },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    env: overrides.env ?? {},
  };
}

// Traces to: FR-PTY-002 (process registry)
describe("PtyRegistry", () => {
  let registry: PtyRegistry;

  beforeEach(() => {
    registry = new PtyRegistry(5);
  });

  it("register and get", () => {
    const rec = makeRecord();
    registry.register(rec);
    expect(registry.get("pty-1")).toBe(rec);
    expect(registry.count()).toBe(1);
  });

  it("throws on duplicate ptyId", () => {
    registry.register(makeRecord());
    expect(() => registry.register(makeRecord())).toThrow(DuplicatePtyError);
  });

  it("enforces capacity limit", () => {
    for (let i = 0; i < 5; i++) {
      registry.register(makeRecord({ ptyId: `pty-${i}` }));
    }
    expect(() => registry.register(makeRecord({ ptyId: "pty-overflow" }))).toThrow(
      RegistryCapacityError
    );
  });

  it("getByLane returns correct records", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1" }));
    registry.register(makeRecord({ ptyId: "b", laneId: "L1" }));
    registry.register(makeRecord({ ptyId: "c", laneId: "L2" }));

    const l1 = registry.getByLane("L1");
    expect(l1).toHaveLength(2);
    expect(l1.map(r => r.ptyId).sort()).toEqual(["a", "b"]);

    expect(registry.getByLane("L2")).toHaveLength(1);
    expect(registry.getByLane("L3")).toHaveLength(0);
  });

  it("getBySession returns correct records", () => {
    registry.register(makeRecord({ ptyId: "a", sessionId: "S1" }));
    registry.register(makeRecord({ ptyId: "b", sessionId: "S2" }));

    expect(registry.getBySession("S1")).toHaveLength(1);
    expect(registry.getBySession("S2")).toHaveLength(1);
    expect(registry.getBySession("S3")).toHaveLength(0);
  });

  it("update bumps updatedAt", () => {
    const rec = makeRecord();
    registry.register(rec);
    const _before = rec.updatedAt;

    // Small delay to ensure timestamp changes
    registry.update("pty-1", { state: "throttled" });
    expect(rec.state).toBe("throttled");
    expect(rec.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("remove cleans up all indexes", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1", sessionId: "S1" }));
    registry.register(makeRecord({ ptyId: "b", laneId: "L1", sessionId: "S1" }));

    registry.remove("a");

    expect(registry.get("a")).toBeUndefined();
    expect(registry.getByLane("L1")).toHaveLength(1);
    expect(registry.getBySession("S1")).toHaveLength(1);
    expect(registry.count()).toBe(1);
  });

  it("remove all entries leaves clean indexes", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1", sessionId: "S1" }));
    registry.remove("a");

    expect(registry.getByLane("L1")).toHaveLength(0);
    expect(registry.getBySession("S1")).toHaveLength(0);
    expect(registry.count()).toBe(0);
  });

  it("list returns all records", () => {
    registry.register(makeRecord({ ptyId: "a" }));
    registry.register(makeRecord({ ptyId: "b" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("update with lane change updates secondary index", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1" }));
    registry.update("a", { laneId: "L2" });

    expect(registry.getByLane("L1")).toHaveLength(0);
    expect(registry.getByLane("L2")).toHaveLength(1);
  });
});
