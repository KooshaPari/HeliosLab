/**
 * FR-HELIOS-039: Audit Retention Policy Tests
 * Verifies: FR-AUD-009 (Retention TTL), FR-AUD-010 (Legal hold exceptions), FR-AUD-011 (Deletion proof)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { RetentionPolicyStore, RetentionPurger } from "../../../src/audit/retention";

describe("RetentionPolicyStore", () => {
  let store: RetentionPolicyStore;

  beforeEach(() => {
    store = new RetentionPolicyStore();
  });

  describe("getPolicy", () => {
    it("should return default policy if not set", () => {
      const policy = store.getPolicy("ws-unknown");

      expect(policy.workspaceId).toBe("ws-unknown");
      expect(policy.ttlDays).toBe(30);
      expect(policy.legalHold).toBe(false);
    });

    it("should return custom policy if set", () => {
      store.setPolicy("ws-1", {
        workspaceId: "ws-1",
        ttlDays: 60,
        legalHold: true,
        purgeSchedule: "weekly",
      });

      const policy = store.getPolicy("ws-1");

      expect(policy.ttlDays).toBe(60);
      expect(policy.legalHold).toBe(true);
    });
  });

  describe("setPolicy", () => {
    it("should update policy", () => {
      store.setPolicy("ws-1", {
        workspaceId: "ws-1",
        ttlDays: 45,
        legalHold: false,
        purgeSchedule: "daily",
      });

      const policy = store.getPolicy("ws-1");
      expect(policy.ttlDays).toBe(45);
    });
  });

  describe("createProof and getProofs", () => {
    it("should store and retrieve deletion proofs", () => {
      const proof = {
        proofId: "proof-1",
        workspaceId: "ws-1",
        purgedEventCount: 100,
        oldestEventTimestamp: "2026-02-01T00:00:00Z",
        newestEventTimestamp: "2026-03-01T00:00:00Z",
        hashChain: "hash1:hash2:hash3",
        purgedAt: new Date().toISOString(),
      };

      store.createProof(proof);

      const proofs = store.getProofs();
      expect(proofs.length).toBe(1);
      expect(proofs[0].proofId).toBe("proof-1");
    });
  });

  describe("computeHashChain", () => {
    it("should compute hash chain from events", () => {
      // Mock events for hashing
      const mockEvents: any[] = [{ id: "event-1" }, { id: "event-2" }, { id: "event-3" }];

      const chain = store.computeHashChain(mockEvents);

      expect(chain).toBeDefined();
      expect(chain).toContain(":"); // Chain separator
    });
  });
});

describe("RetentionPurger", () => {
  let purger: RetentionPurger;
  let store: RetentionPolicyStore;

  beforeEach(() => {
    store = new RetentionPolicyStore();
    purger = new RetentionPurger(store);
  });

  describe("runPurge", () => {
    it("should skip workspaces with legal hold", async () => {
      store.setPolicy("ws-1", {
        workspaceId: "ws-1",
        ttlDays: 30,
        legalHold: true,
        purgeSchedule: "daily",
      });

      const mockStore = {};
      const mockEventSource = {
        getWorkspaces: async () => ["ws-1"],
      };

      // Should not throw; legal hold prevents purge
      await purger.runPurge("ws-1", mockStore, mockEventSource);

      const proofs = store.getProofs();
      expect(proofs.length).toBe(0); // No proof created due to legal hold
    });
  });
});
