import type { LocalBusEnvelope } from "./types";
import { INITIAL_RUNTIME_STATE, transition, type RuntimeEvent, type RuntimeState } from "../sessions/state_machine";

export interface LocalBus {
  publish(event: LocalBusEnvelope): Promise<void>;
  request(command: LocalBusEnvelope): Promise<LocalBusEnvelope>;
}

type HandledMethod = "lane.create" | "session.attach" | "terminal.spawn";

type MethodTransitionSpec = {
  requested: RuntimeEvent;
  succeeded: RuntimeEvent;
  failed: RuntimeEvent;
  startedTopic: string;
  successTopic: string;
  failedTopic: string;
  resultKey: string;
};

const METHOD_SPECS: Record<HandledMethod, MethodTransitionSpec> = {
  "lane.create": {
    requested: "lane.create.requested",
    succeeded: "lane.create.succeeded",
    failed: "lane.create.failed",
    startedTopic: "lane.create.started",
    successTopic: "lane.created",
    failedTopic: "lane.create.failed",
    resultKey: "lane_id"
  },
  "session.attach": {
    requested: "session.attach.requested",
    succeeded: "session.attach.succeeded",
    failed: "session.terminated",
    startedTopic: "session.attach.started",
    successTopic: "session.attached",
    failedTopic: "session.attach.failed",
    resultKey: "session_id"
  },
  "terminal.spawn": {
    requested: "terminal.spawn.requested",
    succeeded: "terminal.spawn.succeeded",
    failed: "terminal.error",
    startedTopic: "terminal.spawn.started",
    successTopic: "terminal.spawned",
    failedTopic: "terminal.spawn.failed",
    resultKey: "terminal_id"
  }
};

export class InMemoryLocalBus implements LocalBus {
  private state: RuntimeState = INITIAL_RUNTIME_STATE;
  private readonly eventLog: LocalBusEnvelope[] = [];
  private rendererEngine: "ghostty" | "rio" = "ghostty";

  getState(): RuntimeState {
    return this.state;
  }

  getEvents(): LocalBusEnvelope[] {
    return [...this.eventLog];
  }

  async publish(event: LocalBusEnvelope): Promise<void> {
    this.eventLog.push(event);
    return;
  }

  async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const method = command.method as HandledMethod | undefined;
    if (method && METHOD_SPECS[method]) {
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
      result: {}
    };
  }

  private async handleLifecycleCommand(command: LocalBusEnvelope, method: HandledMethod): Promise<LocalBusEnvelope> {
    const spec = METHOD_SPECS[method];
    const forcedError = command.payload?.force_error === true;
    const resultId = command.payload?.id ?? `${spec.resultKey}_${Date.now()}`;
    const preferredTransport = typeof command.payload?.preferred_transport === "string"
      ? command.payload.preferred_transport
      : "cliproxy_harness";
    const degraded = command.payload?.simulate_degrade === true;
    const resolvedTransport = degraded ? "native_openai" : preferredTransport;
    const degradedReason = degraded
      ? "cliproxy_harness_unhealthy"
      : null;

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
          details: { method }
        }
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
        state: this.state,
        diagnostics: {
          preferred_transport: preferredTransport,
          resolved_transport: resolvedTransport,
          degraded_reason: degradedReason,
          degraded_at: degraded ? new Date().toISOString() : null
        }
      }
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
        hot_swap_supported: true
      }
    };
  }

  private async handleRendererSwitch(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const nextEngine = command.payload?.target_engine;
    const forcedError = command.payload?.force_error === true;
    const previousEngine = this.rendererEngine;

    await this.publish({
      id: `${command.id}:renderer.switch.started`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "renderer.switch.started",
      payload: {
        previous_engine: previousEngine,
        target_engine: nextEngine
      }
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
          reason: forcedError ? "forced_error" : "invalid_renderer_engine"
        }
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
            target_engine: nextEngine
          }
        }
      };
    }

    this.rendererEngine = nextEngine;
    await this.publish({
      id: `${command.id}:renderer.switch.succeeded`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "renderer.switch.succeeded",
      payload: {
        previous_engine: previousEngine,
        active_engine: this.rendererEngine
      }
    });

    return {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      status: "ok",
      result: {
        active_engine: this.rendererEngine,
        previous_engine: previousEngine
      }
    };
  }

  private async emitTransitionEvent(command: LocalBusEnvelope, runtimeEvent: RuntimeEvent, topic: string): Promise<void> {
    this.state = transition(this.state, runtimeEvent);
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
        state: this.state
      }
    });
  }
}
