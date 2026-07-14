// T005 - Lane sharing (multi-agent concurrent access)


import type { LaneRegistry } from "./registry.js";
import { transition, withLaneLock, recordTransition, type LaneState } from "./state_machine.js";

export class LaneClosedError extends Error {
  constructor(laneId: string) {
    super(`Cannot operate on closed lane: ${laneId}`);
    this.name = "LaneClosedError";
  }
}

export class SharedLaneCleanupError extends Error {
  constructor(laneId: string, agentCount: number) {
    super(`Cannot clean up shared lane ${laneId} with ${agentCount} attached agent(s)`);
    this.name = "SharedLaneCleanupError";
  }
}

export interface ShareResult {
  fromState: LaneState;
  toState: LaneState;
  laneId: string;
}

/**
 * Transition a lane to shared state.
 * Idempotent: if already shared, returns current state without error.
 */
export async function shareLane(registry: LaneRegistry, laneId: string): Promise<ShareResult> {
  return withLaneLock(laneId, async () => {
    const lane = registry.get(laneId);
    if (!lane) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    if (lane.state === "closed") {
      throw new LaneClosedError(laneId);
    }
    // Idempotent: already shared
    if (lane.state === "shared") {
      return { fromState: "shared", toState: "shared", laneId };
    }
    const fromState = lane.state;
    const toState = transition(lane.state, "share", laneId);
    recordTransition(laneId, fromState, "share", toState);
    registry.update(laneId, { state: toState });
    return { fromState, toState, laneId };
  });
}

/**
 * Attach an agent to a lane.
 * Idempotent: attaching the same agent twice is a no-op.
 * Rejects if lane is closed.
 */
export async function attachAgent(
  registry: LaneRegistry,
  laneId: string,
  agentId: string
): Promise<void> {
  return withLaneLock(laneId, async () => {
    const lane = registry.get(laneId);
    if (!lane) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    if (lane.state === "closed") {
      throw new LaneClosedError(laneId);
    }
    // Idempotent: already attached
    if (lane.attachedAgents.includes(agentId)) {
      return;
    }
    registry.update(laneId, {
      attachedAgents: [...lane.attachedAgents, agentId],
    });
  });
}

/**
 * Detach an agent from a lane.
 * If last agent detaches from a shared lane, transitions to ready.
 * Detaching an agent not in the list is a no-op.
 */
export async function detachAgent(
  registry: LaneRegistry,
  laneId: string,
  agentId: string
): Promise<{
  transitioned: boolean;
  fromState?: LaneState;
  toState?: LaneState;
}> {
  return withLaneLock(laneId, async () => {
    const lane = registry.get(laneId);
    if (!lane) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    // No-op if agent not attached
    if (!lane.attachedAgents.includes(agentId)) {
      return { transitioned: false };
    }
    const remaining = lane.attachedAgents.filter(a => a !== agentId);
    registry.update(laneId, { attachedAgents: remaining });

    // If shared and last agent detaches, transition to ready
    if (lane.state === "shared" && remaining.length === 0) {
      const fromState = lane.state;
      const toState = transition(lane.state, "unshare", laneId);
      recordTransition(laneId, fromState, "unshare", toState);
      registry.update(laneId, { state: toState });
      return { transitioned: true, fromState, toState };
    }
    return { transitioned: false };
  });
}

/**
 * Force-detach all agents from a shared lane (for force-cleanup scenarios).
 */
export async function forceDetachAll(
  registry: LaneRegistry,
  laneId: string
): Promise<{
  detachedAgents: string[];
  transitioned: boolean;
  fromState?: LaneState;
  toState?: LaneState;
}> {
  return withLaneLock(laneId, async () => {
    const lane = registry.get(laneId);
    if (!lane) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    const detachedAgents = [...lane.attachedAgents];
    registry.update(laneId, { attachedAgents: [] });

    if (lane.state === "shared") {
      const fromState = lane.state;
      const toState = transition(lane.state, "unshare", laneId);
      recordTransition(laneId, fromState, "unshare", toState);
      registry.update(laneId, { state: toState });
      return { detachedAgents, transitioned: true, fromState, toState };
    }
    return { detachedAgents, transitioned: false };
  });
}
