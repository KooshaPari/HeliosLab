import { createHash } from "node:crypto";
import type { AuditEvent } from "./event";

export interface RetentionPolicy {
  workspaceId: string;
  ttlDays: number;
  legalHold: boolean;
  purgeSchedule: string;
}

export interface DeletionProof {
  proofId: string;
  workspaceId: string;
  purgedEventCount: number;
  oldestEventTimestamp: string;
  newestEventTimestamp: string;
  cutoffTimestamp: string;
  reason: "retention_ttl_expired";
  hashChain: string;
  previousProofHash: string;
  proofHash: string;
  purgedAt: string;
}

export interface RetentionDeletionStore {
  deleteEvents(workspaceId: string, eventIds: string[]): Promise<number> | number;
}

export interface RetentionEventSource {
  getWorkspaces(): Promise<string[]> | string[];
  getExpiredEvents(
    workspaceId: string,
    cutoff: Date
  ): Promise<AuditEvent[]> | AuditEvent[];
}

export interface RetentionClock {
  now(): Date;
}

export interface RetentionTimer {
  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemClock: RetentionClock = { now: () => new Date() };
const systemTimer: RetentionTimer = {
  setInterval: (callback, intervalMs) => setInterval(() => void callback(), intervalMs),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class RetentionPolicyStore {
  private policies = new Map<string, RetentionPolicy>();
  private proofs: DeletionProof[] = [];

  getPolicy(workspaceId: string): RetentionPolicy {
    return (
      this.policies.get(workspaceId) ?? {
        workspaceId,
        ttlDays: 30,
        legalHold: false,
        purgeSchedule: "daily",
      }
    );
  }

  setPolicy(workspaceId: string, policy: RetentionPolicy): void {
    if (policy.workspaceId !== workspaceId || !Number.isInteger(policy.ttlDays) || policy.ttlDays < 1) {
      throw new Error("Invalid retention policy");
    }
    this.policies.set(workspaceId, { ...policy });
  }

  createProof(proof: DeletionProof): void {
    const previousHash = this.proofs.at(-1)?.proofHash ?? "GENESIS";
    if (proof.previousProofHash !== previousHash || !this.verifyDeletionProof(proof)) {
      throw new Error("Invalid deletion proof chain");
    }
    this.proofs.push(Object.freeze({ ...proof }));
  }

  getProofs(): DeletionProof[] {
    return this.proofs.map(proof => ({ ...proof }));
  }

  computeHashChain(events: AuditEvent[]): string {
    let chain = "GENESIS";
    for (const event of [...events].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)
    )) {
      chain = sha256(`${chain}:${stable(event)}`);
    }
    return chain;
  }

  computeProofHash(proof: Omit<DeletionProof, "proofHash">): string {
    return sha256(stable(proof));
  }

  verifyDeletionProof(proof: DeletionProof): boolean {
    const { proofHash, ...content } = proof;
    return proofHash === this.computeProofHash(content);
  }

  verifyProofChain(): boolean {
    let previous = "GENESIS";
    for (const proof of this.proofs) {
      if (proof.previousProofHash !== previous || !this.verifyDeletionProof(proof)) return false;
      previous = proof.proofHash;
    }
    return true;
  }
}

export class RetentionPurger {
  private timerHandle: unknown;

  constructor(
    private readonly policyStore: RetentionPolicyStore,
    private readonly clock: RetentionClock = systemClock,
    private readonly timer: RetentionTimer = systemTimer
  ) {}

  start(
    intervalMs: number,
    store: RetentionDeletionStore,
    eventSource: RetentionEventSource,
    workspaceId?: string
  ): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError("Purge interval must be positive");
    }
    if (this.timerHandle !== undefined) return;
    this.timerHandle = this.timer.setInterval(
      async () => {
        await this.runPurge(workspaceId, store, eventSource);
      },
      intervalMs
    );
  }

  stop(): void {
    if (this.timerHandle !== undefined) {
      this.timer.clearInterval(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  isScheduled(): boolean {
    return this.timerHandle !== undefined;
  }

  async runPurge(
    workspaceId: string | undefined,
    store: RetentionDeletionStore,
    eventSource: RetentionEventSource
  ): Promise<DeletionProof[]> {
    const workspaces = workspaceId ? [workspaceId] : await eventSource.getWorkspaces();
    const proofs: DeletionProof[] = [];

    for (const ws of workspaces) {
      const policy = this.policyStore.getPolicy(ws);
      if (policy.legalHold) continue;

      const now = this.clock.now();
      const cutoff = new Date(now.getTime() - policy.ttlDays * 24 * 60 * 60 * 1000);
      const expired = (await eventSource.getExpiredEvents(ws, cutoff))
        .filter(event => event.workspaceId === ws && Date.parse(event.timestamp) < cutoff.getTime())
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
      if (expired.length === 0) continue;

      const deletedCount = await store.deleteEvents(ws, expired.map(event => event.id));
      if (deletedCount !== expired.length) {
        throw new Error(`Retention delete count mismatch for ${ws}`);
      }

      const previousProofHash = this.policyStore.getProofs().at(-1)?.proofHash ?? "GENESIS";
      const content: Omit<DeletionProof, "proofHash"> = {
        proofId: `proof-${ws}-${now.getTime()}-${expired.length}`,
        workspaceId: ws,
        purgedEventCount: expired.length,
        oldestEventTimestamp: expired[0]!.timestamp,
        newestEventTimestamp: expired.at(-1)!.timestamp,
        cutoffTimestamp: cutoff.toISOString(),
        reason: "retention_ttl_expired",
        hashChain: this.policyStore.computeHashChain(expired),
        previousProofHash,
        purgedAt: now.toISOString(),
      };
      const proof: DeletionProof = {
        ...content,
        proofHash: this.policyStore.computeProofHash(content),
      };
      this.policyStore.createProof(proof);
      proofs.push(proof);
    }

    return proofs;
  }
}
