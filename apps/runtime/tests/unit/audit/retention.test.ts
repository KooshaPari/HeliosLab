import { beforeEach, describe, expect, it } from "bun:test";
import { createAuditEvent, AUDIT_EVENT_RESULTS, AUDIT_EVENT_TYPES } from "../../../src/audit/event";
import {
  RetentionPolicyStore,
  RetentionPurger,
  type RetentionTimer,
} from "../../../src/audit/retention";

function auditEvent(id: string, workspaceId: string, timestamp: string) {
  return {
    ...createAuditEvent({
      eventType: AUDIT_EVENT_TYPES.SESSION_LIFECYCLE,
      actor: "system",
      action: "retain",
      target: id,
      result: AUDIT_EVENT_RESULTS.SUCCESS,
      workspaceId,
      correlationId: `corr-${id}`,
      metadata: { id },
    }),
    id,
    timestamp,
  };
}

class FakeTimer implements RetentionTimer {
  callback: (() => void | Promise<void>) | undefined;
  intervalMs = 0;
  clearCount = 0;

  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown {
    this.callback = callback;
    this.intervalMs = intervalMs;
    return "timer-1";
  }

  clearInterval(): void {
    this.clearCount++;
    this.callback = undefined;
  }

  async trigger(): Promise<void> {
    await this.callback?.();
  }
}

describe("RetentionPolicyStore", () => {
  let store: RetentionPolicyStore;

  beforeEach(() => {
    store = new RetentionPolicyStore();
  });

  it("returns the default policy and validates custom policies", () => {
    expect(store.getPolicy("ws-unknown")).toEqual({
      workspaceId: "ws-unknown",
      ttlDays: 30,
      legalHold: false,
      purgeSchedule: "daily",
    });
    expect(() =>
      store.setPolicy("ws-1", {
        workspaceId: "other",
        ttlDays: 30,
        legalHold: false,
        purgeSchedule: "daily",
      })
    ).toThrow("Invalid retention policy");
  });

  it("computes deterministic, content-sensitive event hash chains", () => {
    const first = auditEvent("event-1", "ws-1", "2026-01-01T00:00:00.000Z");
    const second = auditEvent("event-2", "ws-1", "2026-01-02T00:00:00.000Z");

    expect(store.computeHashChain([first, second])).toBe(store.computeHashChain([second, first]));
    expect(store.computeHashChain([first, second])).not.toBe(
      store.computeHashChain([{ ...first, actor: "tampered" }, second])
    );
  });
});

describe("RetentionPurger", () => {
  const now = new Date("2026-03-15T00:00:00.000Z");
  let policies: RetentionPolicyStore;
  let timer: FakeTimer;
  let purger: RetentionPurger;

  beforeEach(() => {
    policies = new RetentionPolicyStore();
    timer = new FakeTimer();
    purger = new RetentionPurger(policies, { now: () => new Date(now) }, timer);
    policies.setPolicy("ws-1", {
      workspaceId: "ws-1",
      ttlDays: 30,
      legalHold: false,
      purgeSchedule: "daily",
    });
  });

  it("deletes only expired events and records a verifiable deletion proof", async () => {
    const old1 = auditEvent("old-1", "ws-1", "2026-01-01T00:00:00.000Z");
    const old2 = auditEvent("old-2", "ws-1", "2026-02-01T00:00:00.000Z");
    const recent = auditEvent("recent", "ws-1", "2026-03-01T00:00:00.000Z");
    const deleted: string[] = [];

    const proofs = await purger.runPurge(
      "ws-1",
      {
        deleteEvents: (_workspaceId, ids) => {
          deleted.push(...ids);
          return ids.length;
        },
      },
      {
        getWorkspaces: () => ["ws-1"],
        getExpiredEvents: () => [old2, recent, old1],
      }
    );

    expect(deleted).toEqual(["old-1", "old-2"]);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      workspaceId: "ws-1",
      purgedEventCount: 2,
      oldestEventTimestamp: old1.timestamp,
      newestEventTimestamp: old2.timestamp,
      cutoffTimestamp: "2026-02-13T00:00:00.000Z",
      reason: "retention_ttl_expired",
      previousProofHash: "GENESIS",
      purgedAt: now.toISOString(),
    });
    expect(proofs[0]!.hashChain).toHaveLength(64);
    expect(proofs[0]!.proofHash).toHaveLength(64);
    expect(policies.verifyDeletionProof(proofs[0]!)).toBe(true);
    expect(policies.verifyProofChain()).toBe(true);
    expect(
      policies.verifyDeletionProof({ ...proofs[0]!, purgedEventCount: 3 })
    ).toBe(false);
  });

  it("bypasses deletion and proof creation while legal hold is active", async () => {
    policies.setPolicy("ws-1", {
      workspaceId: "ws-1",
      ttlDays: 30,
      legalHold: true,
      purgeSchedule: "daily",
    });
    let queried = false;
    let deleted = false;

    const proofs = await purger.runPurge(
      "ws-1",
      { deleteEvents: () => { deleted = true; return 0; } },
      {
        getWorkspaces: () => ["ws-1"],
        getExpiredEvents: () => { queried = true; return []; },
      }
    );

    expect(queried).toBe(false);
    expect(deleted).toBe(false);
    expect(proofs).toEqual([]);
    expect(policies.getProofs()).toEqual([]);
  });

  it("refuses to create proof when the deletion count is incomplete", async () => {
    const old = auditEvent("old", "ws-1", "2026-01-01T00:00:00.000Z");
    await expect(
      purger.runPurge(
        "ws-1",
        { deleteEvents: () => 0 },
        { getWorkspaces: () => ["ws-1"], getExpiredEvents: () => [old] }
      )
    ).rejects.toThrow("delete count mismatch");
    expect(policies.getProofs()).toEqual([]);
  });

  it("schedules deterministic purge cycles and stops cleanly", async () => {
    const old = auditEvent("old", "ws-1", "2026-01-01T00:00:00.000Z");
    const deleted: string[] = [];
    purger.start(
      5_000,
      { deleteEvents: (_workspaceId, ids) => { deleted.push(...ids); return ids.length; } },
      { getWorkspaces: () => ["ws-1"], getExpiredEvents: () => [old] },
      "ws-1"
    );

    expect(purger.isScheduled()).toBe(true);
    expect(timer.intervalMs).toBe(5_000);
    await timer.trigger();
    expect(deleted).toEqual(["old"]);
    expect(policies.getProofs()).toHaveLength(1);

    purger.stop();
    expect(purger.isScheduled()).toBe(false);
    expect(timer.clearCount).toBe(1);
  });
});
