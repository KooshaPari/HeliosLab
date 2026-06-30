// CommandBusImpl — extracted from emitter.ts for static analysis compliance.

import type { LocalBusEnvelope } from "../types.js";
import type {
  LocalBus,
  CommandBusOptions,
  CommandEnvelope,
  EventEnvelope,
  ResponseEnvelope,
} from "./types.js";
import type { MethodHandler } from "../methods.js";
import { isCommandEnvelope, isEventEnvelope } from "./validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorResponse(
  _id: string,
  correlationId: string,
  method: string,
  code: string,
  message: string
): ResponseEnvelope {
  return {
    id: `res_${Date.now()}`,
    // biome-ignore lint/style/useNamingConvention: Protocol field names intentionally use snake_case.
    correlation_id: correlationId,
    ts: new Date().toISOString(),
    type: "response",
    status: "error",
    method,
    payload: null,
    error: { code, message },
  };
}

// ---------------------------------------------------------------------------
// CommandBusImpl — used by bus.test.ts and topics.test.ts via createBus()
// ---------------------------------------------------------------------------

export class CommandBusImpl implements LocalBus {
  private readonly methods = new Map<string, MethodHandler>();
  private readonly subscribers = new Map<
    string,
    Array<{
      handler: (evt: EventEnvelope) => void | Promise<void>;
      removed: boolean;
    }>
  >();
  private readonly options: Required<CommandBusOptions>;
  private destroyed = false;
  private activeCorrelationId: string | undefined = undefined;
  private currentDepth = 0;
  private topicSequenceCounters = new Map<string, number>();

  constructor(options: CommandBusOptions = {}) {
    this.options = { maxDepth: options.maxDepth ?? 10 };
  }

  registerMethod(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Command dispatch intentionally models protocol branching in one place.
  async send(envelope: unknown): Promise<ResponseEnvelope> {
    // Guard destroyed state
    if (this.destroyed) {
      const id =
        typeof (envelope as Record<string, unknown>)?.id === "string"
          ? ((envelope as Record<string, unknown>).id as string)
          : "unknown";
      const corr =
        typeof (envelope as Record<string, unknown>)?.correlation_id === "string"
          ? ((envelope as Record<string, unknown>).correlation_id as string)
          : "unknown";
      return makeErrorResponse(id, corr, "", "VALIDATION_ERROR", "Bus is destroyed");
    }

    // Validate envelope shape
    if (!isCommandEnvelope(envelope)) {
      const id =
        typeof (envelope as Record<string, unknown>)?.id === "string"
          ? ((envelope as Record<string, unknown>).id as string)
          : "unknown";
      const corr =
        typeof (envelope as Record<string, unknown>)?.correlation_id === "string"
          ? ((envelope as Record<string, unknown>).correlation_id as string)
          : "unknown";
      const type = (envelope as Record<string, unknown>)?.type;
      if (type === "event" || type === "response") {
        return makeErrorResponse(id, corr, "", "VALIDATION_ERROR", "Expected a command envelope");
      }
      return makeErrorResponse(id, corr, "", "VALIDATION_ERROR", "Malformed envelope");
    }

    const cmd = envelope as CommandEnvelope;

    // Depth guard
    if (this.currentDepth >= this.options.maxDepth) {
      return makeErrorResponse(
        cmd.id,
        cmd.correlation_id,
        cmd.method,
        "HANDLER_ERROR",
        `Re-entrant depth limit exceeded (max ${this.options.maxDepth})`
      );
    }

    const handler = this.methods.get(cmd.method);
    if (!handler) {
      return makeErrorResponse(
        cmd.id,
        cmd.correlation_id,
        cmd.method,
        "METHOD_NOT_FOUND",
        `No handler registered for method: ${cmd.method}`
      );
    }

    // Execute handler
    const prevCorrelation = this.activeCorrelationId;
    this.activeCorrelationId = cmd.correlation_id;
    this.currentDepth++;

    try {
      const result = await handler(cmd as unknown as import("../types.js").CommandEnvelope);
      // Validate result is a response envelope
      if (
        !result ||
        typeof result !== "object" ||
        (result as unknown as Record<string, unknown>)["type"] !== "response"
      ) {
        return makeErrorResponse(
          cmd.id,
          cmd.correlation_id,
          cmd.method,
          "HANDLER_ERROR",
          `Handler for "${cmd.method}" returned non-envelope value`
        );
      }
      return result as ResponseEnvelope;
    } catch {
      const msg =
        err instanceof Error ? err.message.replace(/\/[\w/.:-]+/g, "<path>") : String(err);
      return makeErrorResponse(
        cmd.id,
        cmd.correlation_id,
        cmd.method,
        "HANDLER_ERROR",
        `Handler for "${cmd.method}" failed: ${msg}`
      );
    } finally {
      this.currentDepth--;
      this.activeCorrelationId = prevCorrelation;
    }
  }

  subscribe(topic: string, handler: (evt: EventEnvelope) => void | Promise<void>): () => void {
    let list = this.subscribers.get(topic);
    if (!list) {
      list = [];
      this.subscribers.set(topic, list);
    }
    const entry = { handler, removed: false };
    list.push(entry);
    return () => {
      entry.removed = true;
      const current = this.subscribers.get(topic);
      if (current) {
        const idx = current.indexOf(entry);
        if (idx !== -1) {
          current.splice(idx, 1);
        }
        if (current.length === 0) {
          this.subscribers.delete(topic);
        }
      }
    };
  }

  async publish(evt: unknown): Promise<void> {
    if (this.destroyed) {
      return;
    }

    // Silently discard invalid envelopes (per FR-009)
    if (!isEventEnvelope(evt)) {
      return;
    }

    const event = evt as EventEnvelope;

    // Inject active correlation_id from command context (FR-008)
    if (this.activeCorrelationId) {
      (event as unknown as Record<string, unknown>)["correlation_id"] = this.activeCorrelationId;
    }

    const _topic = event.topic;

    // Assign per-topic sequence number
    const currentSeq = this.topicSequenceCounters.get(_topic) ?? 0;
    const nextSeq = currentSeq + 1;
    this.topicSequenceCounters.set(_topic, nextSeq);
    (event as unknown as Record<string, unknown>)["sequence"] = nextSeq;
    const list = this.subscribers.get(_topic);
    if (!list) {
      return;
    }

    // Snapshot before iteration (FR-010)
    // Clone handler references so unsubscribe during iteration does not affect delivery
    const snapshot = list.map(entry => entry.handler);
    for (const handler of snapshot) {
      try {
        await handler(event);
      } catch {
        // FR-009: subscriber isolation — errors are silently swallowed
      }
    }
  }

  async request(command: LocalBusEnvelope): Promise<LocalBusEnvelope> {
    const response = await this.send(command);
    return response as unknown as LocalBusEnvelope;
  }

  destroy(): void {
    this.destroyed = true;
    this.methods.clear();
    this.subscribers.clear();
  }

  getActiveCorrelationId(): string | undefined {
    return this.activeCorrelationId;
  }
}

export function createBus(options?: CommandBusOptions): LocalBus {
  return new CommandBusImpl(options);
}
