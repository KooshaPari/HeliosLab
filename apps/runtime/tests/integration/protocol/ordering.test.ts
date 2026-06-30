/**
 * FR-HELIOS-087: Event Sequencing and Correlation Propagation Tests
 * Verifies: FR-BUS-005 (Monotonic sequence numbers), FR-BUS-008 (Correlation ID propagation), FR-BUS-009 (Subscriber isolation)
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { createBus } from "../../../src/protocol/bus.js";
import type { LocalBus } from "../../../src/protocol/bus.js";
import { createCommand, createEvent, createResponse } from "../../../src/protocol/envelope.js";
import type { LocalBusEnvelope } from "../../../src/protocol/types.js";

describe("Event ordering — per-topic monotonic sequences", () => {
  let bus: LocalBus;

  beforeEach(() => {
    bus = createBus();
  });

  // FR-005: 10,000 concurrent publishes produce zero sequence inversions
  it("maintains strictly increasing sequences across 10,000 events on one topic", async () => {
    const received: number[] = [];

    bus.subscribe("load.test", event => {
      received.push(event.sequence!);
    });

    // Publish 10,000 events (all awaited — simulates concurrent async contexts)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10_000; i++) {
      const evt = createEvent("load.test", { i }) as LocalBusEnvelope;
      promises.push(bus.publish(evt));
    }
    await Promise.all(promises);

    expect(received.length).toBe(10_000);

    // Assert strictly increasing
    for (let i = 1; i < received.length; i++) {
      const prev = received[i - 1]!;
      const curr = received[i]!;
      expect(curr).toBeGreaterThan(prev);
    }

    // First event should be sequence 1
    expect(received[0]).toBe(1);
  });

  // FR-005: independent topic counters
  it("maintains independent sequence counters per topic", async () => {
    const topicA: number[] = [];
    const topicB: number[] = [];

    bus.subscribe("topic.a", e => {
      topicA.push(e.sequence!);
    });
    bus.subscribe("topic.b", e => {
      topicB.push(e.sequence!);
    });

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(bus.publish(createEvent("topic.a", { i }) as LocalBusEnvelope));
      promises.push(bus.publish(createEvent("topic.b", { i }) as LocalBusEnvelope));
    }
    await Promise.all(promises);

    expect(topicA.length).toBe(100);
    expect(topicB.length).toBe(100);

    // Both start at 1 independently
    expect(topicA[0]).toBe(1);
    expect(topicB[0]).toBe(1);

    // Both are monotonically increasing
    for (let i = 1; i < topicA.length; i++) {
      expect(topicA[i]!).toBeGreaterThan(topicA[i - 1]!);
    }
    for (let i = 1; i < topicB.length; i++) {
      expect(topicB[i]!).toBeGreaterThan(topicB[i - 1]!);
    }
  });

  // FR-005: 10 topics concurrent
  it("handles 10 topics concurrently with independent monotonic sequences", async () => {
    const topicEvents = new Map<string, number[]>();
    const topicNames = Array.from({ length: 10 }, (_, i) => `concurrent.topic${String(i)}`);

    for (const topic of topicNames) {
      topicEvents.set(topic, []);
      bus.subscribe(topic, e => {
        topicEvents.get(topic)!.push(e.sequence!);
      });
    }

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      for (const topic of topicNames) {
        promises.push(bus.publish(createEvent(topic, { i }) as LocalBusEnvelope));
      }
    }
    await Promise.all(promises);

    for (const [_topic, seqs] of topicEvents) {
      expect(seqs.length).toBe(100);
      expect(seqs[0]).toBe(1);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
      }
    }
  });
});

describe("Correlation ID propagation", () => {
  let bus: LocalBus;

  beforeEach(() => {
    bus = createBus();
  });

  // FR-008: events inside command handler inherit correlation_id
  it("propagates correlation_id from command to events published in handler", async () => {
    const receivedCorrelations: string[] = [];

    bus.subscribe("handler.event", e => {
      receivedCorrelations.push(e.correlation_id!);
    });

    bus.registerMethod("emit.events", async cmd => {
      // Publish 5 events inside the handler
      for (let i = 0; i < 5; i++) {
        const evt = createEvent("handler.event", { i }) as LocalBusEnvelope;
        await bus.publish(evt);
      }
      return createResponse(cmd, { result: "done" });
    });

    const cmd = createCommand("emit.events", {}, "trace_cmd_123");
    await bus.send(cmd);

    expect(receivedCorrelations.length).toBe(5);
    // All events should inherit the command's correlation_id
    for (const corr of receivedCorrelations) {
      expect(corr).toBe("trace_cmd_123");
    }
  });

  // FR-008: events outside command context retain their own correlation_id
  it("events outside command context retain their own correlation_id", async () => {
    const received: string[] = [];

    bus.subscribe("standalone.event", e => {
      received.push(e.correlation_id!);
    });

    const evt = createEvent("standalone.event", {}, "my_own_correlation") as LocalBusEnvelope;
    await bus.publish(evt);

    expect(received.length).toBe(1);
    expect(received[0]).toBe("my_own_correlation");
  });

  // FR-008: nested commands maintain their own correlation context
  it("nested dispatch maintains isolated correlation contexts", async () => {
    const outerCorrelations: string[] = [];
    const innerCorrelations: string[] = [];

    bus.subscribe("outer.event", e => {
      outerCorrelations.push(e.correlation_id!);
    });
    bus.subscribe("inner.event", e => {
      innerCorrelations.push(e.correlation_id!);
    });

    bus.registerMethod("inner.cmd", async cmd => {
      // Check that active correlation is the inner command's
      expect(bus.getActiveCorrelationId()).toBe(cmd.correlation_id);
      await bus.publish(createEvent("inner.event", {}) as LocalBusEnvelope);
      return createResponse(cmd, { result: "inner-done" });
    });

    bus.registerMethod("outer.cmd", async cmd => {
      // Publish event — should get outer correlation
      await bus.publish(createEvent("outer.event", {}) as LocalBusEnvelope);

      // Dispatch inner command with different correlation
      const innerCmd = createCommand("inner.cmd", {}, "inner_trace_456");
      await bus.send(innerCmd);

      // After inner returns, active correlation should be outer again
      expect(bus.getActiveCorrelationId()).toBe(cmd.correlation_id);

      // Publish another outer event
      await bus.publish(createEvent("outer.event", {}) as LocalBusEnvelope);

      return createResponse(cmd, { result: "outer-done" });
    });

    const cmd = createCommand("outer.cmd", {}, "outer_trace_123");
    await bus.send(cmd);

    expect(outerCorrelations.length).toBe(2);
    for (const c of outerCorrelations) {
      expect(c).toBe("outer_trace_123");
    }

    expect(innerCorrelations.length).toBe(1);
    expect(innerCorrelations[0]).toBe("inner_trace_456");
  });

  // FR-008: getActiveCorrelationId returns undefined outside dispatch
  it("getActiveCorrelationId returns undefined outside dispatch", () => {
    expect(bus.getActiveCorrelationId()).toBeUndefined();
  });
});
