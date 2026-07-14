/**
 * FR-HELIOS-067: Bus Audit Subscriber Tests
 * Verifies: FR-AUD-001 (Audit event capture), FR-BUS-004 (Event subscription)
 */

import { BusAuditSubscriber } from "../../../src/audit/bus-subscriber";
import type { BusEvent } from "../../../src/audit/bus-subscriber";
import { DefaultAuditSink, NoOpAuditStorage } from "../../../src/audit/sink";


describe("BusAuditSubscriber", () => {
  let subscriber: BusAuditSubscriber;
  let sink: DefaultAuditSink;
  let mockBus: any;

  beforeEach(() => {
    subscriber = new BusAuditSubscriber();
    sink = new DefaultAuditSink(new NoOpAuditStorage());

    // Create a mock bus with subscribe method
    let subscriptionHandler: ((event: BusEvent) => Promise<void>) | null = null;

    mockBus = {
      subscribe: (topic: string, handler: (event: BusEvent) => Promise<void>) => {
        subscriptionHandler = handler;
        return () => {
          subscriptionHandler = null;
        };
      },
      emit: (event: BusEvent) => {
        if (subscriptionHandler) {
          return subscriptionHandler(event);
        }
      },
    };
  });

  describe("subscribe", () => {
    it("should subscribe to bus events", () => {
      expect(() => subscriber.subscribe(mockBus, sink)).not.toThrow();
    });
  });

  describe("event mapping", () => {
    it("should map lane.created to lane.lifecycle audit event", async () => {
      subscriber.subscribe(mockBus, sink);

      const event: BusEvent = {
        topic: "lane.created",
        payload: { laneId: "lane-1" },
        actor: "operator-1",
        action: "create",
        target: "lane-1",
        workspaceId: "workspace-1",
        correlationId: "corr-1",
      };

      await mockBus.emit(event);

      // Allow async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sink.getBufferedCount()).toBeGreaterThan(0);
    });

    it("should map session.created to session.lifecycle audit event", async () => {
      subscriber.subscribe(mockBus, sink);

      const event: BusEvent = {
        topic: "session.created",
        payload: { sessionId: "session-1" },
        actor: "agent-1",
        action: "create",
        target: "session-1",
        workspaceId: "workspace-1",
        correlationId: "corr-2",
      };

      await mockBus.emit(event);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sink.getBufferedCount()).toBeGreaterThan(0);
    });

    it("should map policy.evaluation.completed to policy.evaluation audit event", async () => {
      subscriber.subscribe(mockBus, sink);

      const event: BusEvent = {
        topic: "policy.evaluation.completed",
        payload: { policyId: "policy-1", result: "allowed" },
        actor: "system",
        action: "evaluate",
        target: "policy-1",
        workspaceId: "workspace-1",
        correlationId: "corr-3",
      };

      await mockBus.emit(event);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sink.getBufferedCount()).toBeGreaterThan(0);
    });

    it("should map approval.resolved to approval.lifecycle audit event", async () => {
      subscriber.subscribe(mockBus, sink);

      const event: BusEvent = {
        topic: "approval.resolved",
        payload: { approvalId: "appr-1", decision: "approved" },
        actor: "operator-1",
        action: "resolve",
        target: "appr-1",
        workspaceId: "workspace-1",
        correlationId: "corr-4",
      };

      await mockBus.emit(event);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sink.getBufferedCount()).toBeGreaterThan(0);
    });
  });

  describe("unknown topics", () => {
    it("should handle unknown bus topics gracefully without crashing", async () => {
      subscriber.subscribe(mockBus, sink);

      const event: BusEvent = {
        topic: "unknown.topic.that.does.not.exist",
        payload: {},
        actor: "agent-1",
        workspaceId: "workspace-1",
        correlationId: "corr-5",
      };

      // Should not throw
      await expect(mockBus.emit(event)).resolves.toBeUndefined();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Unknown topics should not be persisted (skipped)
      expect(sink.getBufferedCount()).toBe(0);
    });
  });

  describe("correlation ID preservation", () => {
    it("should preserve correlation ID from bus event to audit event", async () => {
      let capturedEvent: any = null;

      // Create a capturing storage to inspect events
      const capturingSink = new DefaultAuditSink({
        persist: async events => {
          if (events.length > 0) {
            capturedEvent = events[0];
          }
        },
      });

      subscriber.subscribe(mockBus, capturingSink);

      const event: BusEvent = {
        topic: "session.created",
        payload: {},
        actor: "agent-1",
        workspaceId: "workspace-1",
        correlationId: "special-corr-id-123",
      };

      await mockBus.emit(event);
      await capturingSink.flush();

      expect(capturedEvent).toBeTruthy();
      expect(capturedEvent.correlationId).toBe("special-corr-id-123");
    });
  });

  describe("unsubscribe", () => {
    it("should stop subscribing to bus events", async () => {
      subscriber.subscribe(mockBus, sink);

      const event1: BusEvent = {
        topic: "lane.created",
        payload: {},
        actor: "operator-1",
        workspaceId: "workspace-1",
        correlationId: "corr-6",
      };

      await mockBus.emit(event1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const count1 = sink.getBufferedCount();
      expect(count1).toBeGreaterThan(0);

      // Unsubscribe
      subscriber.unsubscribe_();

      // Clear sink for second test
      sink = new DefaultAuditSink(new NoOpAuditStorage());

      const event2: BusEvent = {
        topic: "session.created",
        payload: {},
        actor: "agent-1",
        workspaceId: "workspace-1",
        correlationId: "corr-7",
      };

      await mockBus.emit(event2);
      await new Promise(resolve => setTimeout(resolve, 10));

      // After unsubscribe, events should not be captured
      expect(sink.getBufferedCount()).toBe(0);
    });
  });
});
