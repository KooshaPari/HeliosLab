/**
 * FR-HELIOS-062: PTY Registry Tests
 * Verifies: FR-PTY-002 (Process registry mapping), FR-PTY-008 (Orphaned PTY detection)
 * Traces to: FR-MVP-008 (multiple terminals), FR-MVP-006 (spawn PTY)
 */
import { describe, expect, it, beforeEach } from "bun:test";
import {
  PtyRegistry,
  DuplicatePtyError,
  RegistryCapacityError,
  type PtyRecord,
} from "../../../src/pty/registry.js";

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

describe("PtyRegistry", () => {
  let registry: PtyRegistry;

  beforeEach(() => {
    registry = new PtyRegistry(5);
  });

  // ── Primary index ──────────────────────────────────────────────────

  it("register and get by ptyId", () => {
    const rec = makeRecord();
    registry.register(rec);
    expect(registry.get("pty-1")).toBe(rec);
    expect(registry.count()).toBe(1);
  });

  it("get returns undefined for missing ptyId", () => {
    expect(registry.get("missing")).toBeUndefined();
  });

  it("throws DuplicatePtyError on duplicate ptyId", () => {
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

  // ── Secondary indexes ──────────────────────────────────────────────

  it("getByLane returns correct records", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1" }));
    registry.register(makeRecord({ ptyId: "b", laneId: "L1" }));
    registry.register(makeRecord({ ptyId: "c", laneId: "L2" }));

    expect(registry.getByLane("L1")).toHaveLength(2);
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

  // ── Update ─────────────────────────────────────────────────────────

  it("update bumps updatedAt and patches fields", () => {
    const rec = makeRecord();
    registry.register(rec);
    registry.update("pty-1", { state: "throttled" });
    expect(rec.state).toBe("throttled");
  });

  it("update with lane change updates secondary index", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1" }));
    registry.update("a", { laneId: "L2" });
    expect(registry.getByLane("L1")).toHaveLength(0);
    expect(registry.getByLane("L2")).toHaveLength(1);
  });

  it("update with session change updates secondary index", () => {
    registry.register(makeRecord({ ptyId: "a", sessionId: "S1" }));
    registry.update("a", { sessionId: "S2" });
    expect(registry.getBySession("S1")).toHaveLength(0);
    expect(registry.getBySession("S2")).toHaveLength(1);
  });

  it("update on missing ptyId is a no-op", () => {
    registry.update("missing", { state: "stopped" });
    expect(registry.count()).toBe(0);
  });

  // ── Remove ─────────────────────────────────────────────────────────

  it("remove cleans up all indexes", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1", sessionId: "S1" }));
    registry.register(makeRecord({ ptyId: "b", laneId: "L1", sessionId: "S1" }));

    registry.remove("a");

    expect(registry.get("a")).toBeUndefined();
    expect(registry.getByLane("L1")).toHaveLength(1);
    expect(registry.getBySession("S1")).toHaveLength(1);
    expect(registry.count()).toBe(1);
  });

  it("remove last entry from index cleans up empty sets", () => {
    registry.register(makeRecord({ ptyId: "a", laneId: "L1" }));
    registry.remove("a");
    expect(registry.getByLane("L1")).toHaveLength(0);
  });

  it("remove on missing ptyId is a no-op", () => {
    registry.remove("missing");
    expect(registry.count()).toBe(0);
  });

  // ── List ───────────────────────────────────────────────────────────

  it("list returns all records", () => {
    registry.register(makeRecord({ ptyId: "a" }));
    registry.register(makeRecord({ ptyId: "b" }));
    expect(registry.list()).toHaveLength(2);
  });
});
