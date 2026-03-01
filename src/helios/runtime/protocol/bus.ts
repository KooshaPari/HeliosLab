import type { LocalBusEnvelope } from "./types";
import {
  INITIAL_RUNTIME_STATE,
  transition,
  type RuntimeEvent,
  type RuntimeState,
  type LaneState as LaneStateType,
  type SessionState as SessionStateType,
  type TerminalState as TerminalStateType,
} from "../sessions/state_machine";

export interface BusLaneState {
  laneId: string;
  lane: { state: LaneStateType; transport?: string };
  session: { state: SessionStateType; id?: string };
  terminal: { state: TerminalStateType; id?: string };
  createdAt: string;
}

export interface LocalBus {
  publish(event: LocalBusEnvelope): Promise<void>;
  request(command: LocalBusEnvelope): Promise<LocalBusEnvelope>;
}

type HandledMethod = "lane.create" | "session.attach" | "terminal.spawn" | "lane.switch";

interface MethodTransitionSpec {
  requested: RuntimeEvent;
  succeeded: RuntimeEvent;
  failed: RuntimeEvent;
  startedTopic: string;
  successTopic: string;
  failedTopic: string;
  resultKey: string;
}

const METHOD_SPECS: Record<HandledMethod, MethodTransitionSpec> = {
  "lane.create": {
    requested: "lane.create.requested",
    succeeded: "lane.create.succeeded",
    failed: "lane.create.failed",
    startedTopic: "lane.create.started",
    successTopic: "lane.created",
    failedTopic: "lane.create.failed",
    resultKey: "lane_id",
  },
  "session.attach": {
    requested: "session.attach.requested",
    succeeded: "session.attach.succeeded",
    failed: "session.terminated",
    startedTopic: "session.attach.started",
    successTopic: "session.attached",
    failedTopic: "session.attach.failed",
    resultKey: "session_id",
  },
  "terminal.spawn": {
    requested: "terminal.spawn.requested",
    succeeded: "terminal.spawn.succeeded",
    failed: "terminal.error",
    startedTopic: "terminal.spawn.started",
    successTopic: "terminal.spawned",
    failedTopic: "terminal.spawn.failed",
    resultKey: "terminal_id",
  },
  "lane.switch": {
    requested: "lane.switch.requested",
    succeeded: "lane.switch.succeeded",
    failed: "lane.switch.failed",
    startedTopic: "lane.switch.started",
    successTopic: "lane.switched",
    failedTopic: "lane.switch.failed",
    resultKey: "lane_id",
  },
};

export class InMemoryLocalBus implements LocalBus {
  private lanes = new Map<string, BusLaneState>();
  private currentLaneId = "";
  private readonly eventLog: LocalBusEnvelope[] = [];
  private rendererEngine: "ghostty" | "rio" = "ghostty";

  getState(): RuntimeState {
    if (!this.currentLaneId) {
      return INITIAL_RUNTIME_STATE;
    }
    const lane = this.lanes.get(this.currentLaneId);
    if (!lane) {
      return INITIAL_RUNTIME_STATE;
    }
    return {
      lane: lane.lane.state,
      session: lane.session.state,
      terminal: lane.terminal.state,
    };
  }

  getStateForLane(laneId: string): RuntimeState | undefined {
    const lane = this.lanes.get(laneId);
    if (!lane) {
      return undefined;
    }
    return {
      lane: lane.lane.state,
      session: lane.session.state,
      terminal: lane.terminal.state,
    };
  }

  getLaneState(laneId: string): BusLaneState | undefined {
    return this.lanes.get(laneId);
  }

  getAllLanes(): BusLaneState[] {
    return [...this.lanes.values()];
  }

  switchLane(laneId: string): void {
    if (this.lanes.has(laneId)) {
      this.currentLaneId = laneId;
    }
  }

  getEvents(): LocalBusEnvelope[] {
    return [...this.eventLog];
  }

  restoreState(state: RuntimeState): void {
    if (!this.currentLaneId) {
      return;
    }
    const lane = this.lanes.get(this.currentLaneId);
    if (!lane) {
      return;
    }
    lane.lane.state = state.lane;
    lane.session.state = state.session;
    lane.terminal.state = state.terminal;
  }

  getActiveLanes(): { laneId: string; sessionId?: string; terminalId?: string }[] {
    const activeLanes: { laneId: string; sessionId?: string; terminalId?: string }[] = [];
    for (const [laneId, laneState] of this.lanes) {
      if (laneState.lane.state !== "new" && laneState.lane.state !== "closed") {
        activeLanes.push({
          laneId,
          sessionId: laneState.session.state !== "detached" ? laneState.session.id : undefined,
          terminalId: laneState.terminal.state !== "idle" ? laneState.terminal.id : undefined,
        });
      }
    }
    return activeLanes;
  }

  exportLanes(): BusLaneState[] {
    return [...this.lanes.values()];
  }

  restoreLanes(lanes: BusLaneState[]): void {
    this.lanes.clear();
    for (const lane of lanes) {
      this.lanes.set(lane.laneId, lane);
      if (!this.currentLaneId && lane.laneId) {
        this.currentLaneId = lane.laneId;
      }
    }
  }

  async publish(event: LocalBusEnvelope): Promise<void> {
    this.eventLog.push(event);
  }

  async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const method = command.method as HandledMethod | undefined;
    if (method && METHOD_SPECS[method]) {
      if (method === "lane.switch") {
        return this.handleLaneSwitch(command);
      }
      return this.handleLifecycleCommand(command, method);
    }

    if (command.method === "renderer.capabilities") {
      return this.handleRendererCapabilities(command);
    }

    if (command.method === "renderer.switch") {
      return this.handleRendererSwitch(command);
    }

    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {},
    };
  }

  private async handleLifecycleCommand(
    command: LocalBusEnvelope,
    method: HandledMethod,
  ): Promise<LocalBusEnvelope> {
    const spec = METHOD_SPECS[method];
    const forcedError = command.payload?.["force_error"] === true;
    const resultId =
      (command.payload?.["id"] as string | undefined) ?? `${spec.resultKey}_${Date.now()}`;
    const preferredTransport =
      typeof command.payload?.["preferred_transport"] === "string"
        ? (command.payload["preferred_transport"] as string)
        : "cliproxy_harness";
    const degraded = command.payload?.["simulate_degrade"] === true;
    const resolvedTransport = degraded ? "native_openai" : preferredTransport;
    const degradedReason = degraded ? "cliproxy_harness_unhealthy" : null;

    // For lane.create, create a new lane
    if (method === "lane.create") {
      const laneId = resultId;
      const newLaneState: BusLaneState = {
        laneId,
        lane: { state: "new", transport: preferredTransport },
        session: { state: "detached" },
        terminal: { state: "idle" },
        createdAt: new Date().toISOString(),
      };
      this.lanes.set(laneId, newLaneState);
      this.currentLaneId = laneId;
    }

    await this.emitTransitionEvent(command, spec.requested, spec.startedTopic);

    if (forcedError) {
      await this.emitTransitionEvent(command, spec.failed, spec.failedTopic);
      return {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        status: "error",
        result: null,
        error: {
          code: `${method.toUpperCase().replace(".", "_")}_FAILED`,
          message: `${method} failed`,
          retryable: true,
          details: { method },
        },
      };
    }

    await this.emitTransitionEvent(command, spec.succeeded, spec.successTopic);
    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {
        [spec.resultKey]: resultId,
        state: this.getState(),
        diagnostics: {
          preferred_transport: preferredTransport,
          resolved_transport: resolvedTransport,
          degraded_reason: degradedReason,
          degraded_at: degraded ? new Date().toISOString() : null,
        },
      },
    };
  }

  private async handleRendererCapabilities(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {
        active_engine: this.rendererEngine,
        available_engines: ["ghostty", "rio"],
        hot_swap_supported: true,
      },
    };
  }

  private async handleRendererSwitch(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const nextEngine = command.payload?.["target_engine"] as string | undefined;
    const forcedError = command.payload?.["force_error"] === true;
    const previousEngine = this.rendererEngine;

    await this.publish({
      id: `${command.id}:renderer.switch.started`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "renderer.switch.started",
      payload: {
        previous_engine: previousEngine,
        target_engine: nextEngine,
      },
    });

    if (forcedError || (nextEngine !== "ghostty" && nextEngine !== "rio")) {
      await this.publish({
        id: `${command.id}:renderer.switch.failed`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "renderer.switch.failed",
        payload: {
          previous_engine: previousEngine,
          target_engine: nextEngine,
          reason: forcedError ? "forced_error" : "invalid_renderer_engine",
        },
      });

      return {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        status: "error",
        result: null,
        error: {
          code: "RENDERER_SWITCH_FAILED",
          message: "renderer.switch failed",
          retryable: true,
          details: {
            previous_engine: previousEngine,
            target_engine: nextEngine,
          },
        },
      };
    }

    this.rendererEngine = nextEngine as "ghostty" | "rio";
    await this.publish({
      id: `${command.id}:renderer.switch.succeeded`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "renderer.switch.succeeded",
      payload: {
        previous_engine: previousEngine,
        active_engine: this.rendererEngine,
      },
    });

    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {
        active_engine: this.rendererEngine,
        previous_engine: previousEngine,
      },
    };
  }

  private async handleLaneSwitch(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const laneId =
      (command.payload?.["id"] as string | undefined) ??
      (command.payload?.["laneId"] as string | undefined);

    if (!laneId) {
      return {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        status: "error",
        result: null,
        error: {
          code: "LANE_SWITCH_FAILED",
          message: "lane.switch failed: no laneId provided",
          retryable: false,
          details: {
            reason: "missing_lane_id",
          },
        },
      };
    }

    if (!this.lanes.has(laneId)) {
      return {
        id: command.id,
        type: "response",
        ts: new Date().toISOString(),
        status: "error",
        result: null,
        error: {
          code: "LANE_NOT_FOUND",
          message: `lane.switch failed: lane '${laneId}' not found`,
          retryable: false,
          details: {
            requested_lane_id: laneId,
            available_lanes: [...this.lanes.keys()],
          },
        },
      };
    }

    this.switchLane(laneId);

    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {
        lane_id: laneId,
        state: this.getState(),
      },
    };
  }

  private async emitTransitionEvent(
    command: LocalBusEnvelope,
    runtimeEvent: RuntimeEvent,
    topic: string,
  ): Promise<void> {
    if (!this.currentLaneId) {
      return;
    }
    const lane = this.lanes.get(this.currentLaneId);
    if (!lane) {
      return;
    }

    const currentState = this.getState();
    const newState = transition(currentState, runtimeEvent);

    lane.lane.state = newState.lane;
    lane.session.state = newState.session;
    lane.terminal.state = newState.terminal;

    await this.publish({
      id: `${command.id}:${runtimeEvent}`,
      type: "event",
      ts: new Date().toISOString(),
      workspace_id: command.workspace_id,
      session_id: command.session_id,
      terminal_id: command.terminal_id,
      topic,
      payload: {
        runtime_event: runtimeEvent,
        state: newState,
      },
    });
  }
}
