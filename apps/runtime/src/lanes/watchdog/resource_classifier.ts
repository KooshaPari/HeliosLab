// T005 - Resource classifier for orphaned resources

export type ResourceType = "worktree" | "zellij_session" | "pty_process";
export type RiskLevel = "low" | "medium" | "high";

export interface OrphanedResource {
  type: ResourceType;
  path?: string;
  pid?: number;
  createdAt: string;
  estimatedOwnerId?: string;
  metadata?: Record<string, unknown>;
}

export interface ClassifiedOrphan {
  type: ResourceType;
  path?: string;
  pid?: number;
  age: number; // milliseconds
  estimatedOwner: string; // lane ID or "unknown"
  riskLevel: RiskLevel;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export class ResourceClassifier {
  private readonly now: Date;

  constructor() {
    this.now = new Date();
  }

  classify(resource: OrphanedResource): ClassifiedOrphan {
    const createdAt = new Date(resource.createdAt);
    const age = this.now.getTime() - createdAt.getTime();
    const riskLevel = this.calculateRiskLevel(age, resource.estimatedOwnerId);

    return {
      type: resource.type,
      path: resource.path,
      pid: resource.pid,
      age,
      estimatedOwner: resource.estimatedOwnerId || "unknown",
      riskLevel,
      createdAt: resource.createdAt,
      metadata: resource.metadata,
    };
  }

  classifyAll(resources: OrphanedResource[]): ClassifiedOrphan[] {
    const classified = resources.map(r => this.classify(r));
    // Sort by risk level: high first, then medium, then low
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return classified.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);
  }

  private calculateRiskLevel(ageMs: number, ownerId?: string): RiskLevel {
    const ageHours = ageMs / (1000 * 60 * 60);
    const isUnknownOwner = !ownerId;

    // Unknown owner increases risk
    if (isUnknownOwner) {
      return "high";
    }

    // Known owner: risk increases with age
    if (ageHours < 1) {
      return "low";
    } else if (ageHours < 24) {
      return "medium";
    } else {
      return "high";
    }
  }
}
