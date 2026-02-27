export type LaneSpec = {
  laneId: string;
  repoPath: string;
  branchName: string;
};

export interface ParAdapter {
  createLane(spec: LaneSpec): Promise<{ worktreePath: string }>;
  attachLane(laneId: string): Promise<void>;
  cleanupLane(laneId: string): Promise<void>;
}
