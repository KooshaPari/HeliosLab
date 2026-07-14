import {
  ActiveContextStore,
  type ActiveContext,
  resetActiveContextStore,
  getActiveContextStore,
} from "../../../src/tabs/context_switch";

describe("ActiveContextStore", () => {
  let store: ActiveContextStore;

  beforeEach(() => {
    resetActiveContextStore();
    store = new ActiveContextStore();
  });

  afterEach(() => {
    resetActiveContextStore();
  });

  describe("Context Set/Get/Clear Lifecycle", () => {
    it("should initialize with null context", () => {
      expect(store.getContext()).toBeNull();
    });

    it("should set and retrieve context", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await store.setContext(context);

      expect(store.getContext()).toEqual(context);
    });

    it("should clear context to null", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await store.setContext(context);
      expect(store.getContext()).not.toBeNull();

      await store.clearContext();
      expect(store.getContext()).toBeNull();
    });
  });

  describe("Change Event Emission", () => {
    it("should emit change event with previous and new values", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      let emittedEvent: any = null;

      store.onContextChange(_event => {
        emittedEvent = event;
      });

      await store.setContext(context);

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.previous).toBeNull();
      expect(emittedEvent.current).toEqual(context);
    });

    it("should emit event on context change with previous context", async () => {
      const context1: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const context2: ActiveContext = {
        workspaceId: "ws2",
        laneId: "lane2",
        sessionId: "session2",
      };

      let emittedEvent: any = null;

      await store.setContext(context1);

      store.onContextChange(_event => {
        emittedEvent = event;
      });

      await store.setContext(context2);

      expect(emittedEvent.previous).toEqual(context1);
      expect(emittedEvent.current).toEqual(context2);
    });

    it("should call all registered listeners", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const calls: any[] = [];

      store.onContextChange(_event => {
        calls.push("listener1");
      });

      store.onContextChange(_event => {
        calls.push("listener2");
      });

      await store.setContext(context);

      expect(calls).toContain("listener1");
      expect(calls).toContain("listener2");
    });

    it("should allow unsubscribing from changes", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      let callCount = 0;

      const unsubscribe = store.onContextChange(_event => {
        callCount++;
      });

      await store.setContext(context);
      expect(callCount).toBe(1);

      unsubscribe();

      await store.setContext(context);
      expect(callCount).toBe(1); // Should not have incremented
    });
  });

  describe("Debouncing", () => {
    it("should debounce rapid context changes", async () => {
      const context1: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const context2: ActiveContext = {
        workspaceId: "ws2",
        laneId: "lane2",
        sessionId: "session2",
      };

      const context3: ActiveContext = {
        workspaceId: "ws3",
        laneId: "lane3",
        sessionId: "session3",
      };

      let emittedContexts: ActiveContext[] = [];

      store.onContextChange(_event => {
        if (event.current) {
          emittedContexts.push(event.current);
        }
      });

      // Rapid changes
      store.setContext(context1);
      store.setContext(context2);
      await store.setContext(context3);

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Only the final context should be emitted
      expect(emittedContexts).toHaveLength(1);
      expect(emittedContexts[0]).toEqual(context3);
    });

    it("should use latest context after debounce", async () => {
      const contexts: ActiveContext[] = [
        { workspaceId: "ws1", laneId: "lane1", sessionId: "session1" },
        { workspaceId: "ws2", laneId: "lane2", sessionId: "session2" },
        { workspaceId: "ws3", laneId: "lane3", sessionId: "session3" },
      ];

      let finalContext: ActiveContext | null = null;

      store.onContextChange(_event => {
        finalContext = event.current;
      });

      // Queue rapid changes
      for (const ctx of contexts.slice(0, 2)) {
        await store.setContext(ctx);
      }

      // Final change
      await store.setContext(contexts[2]);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(finalContext!).toEqual(contexts[2]!);
    });
  });

  describe("Context Validation", () => {
    it("should validate context before accepting", async () => {
      const validContext: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      let validated = false;

      store.setValidator(async _ctx => {
        validated = true;
        return true;
      });

      await store.setContext(validContext);

      // Wait for debounce and validation
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(validated).toBe(true);
      expect(store.getContext()).toEqual(validContext);
    });

    it("should reject invalid context", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      store.setValidator(async () => false);

      await store.setContext(context);

      // Wait for debounce and validation
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(store.getContext()).toBeNull();
    });

    it("should emit validation failure event on reject", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      store.setValidator(async () => false);

      let validationFailed = false;

      // Create new store with mock bus
      const mockBus = {
        async publish(event: any) {
          if (event.topic === "context.validation.failed") {
            validationFailed = true;
          }
        },
        async request() {
          return { id: "", type: "response", ts: "", status: "ok" as const };
        },
      };

      const storeWithBus = new ActiveContextStore(mockBus as any);
      storeWithBus.setValidator(async () => false);

      await storeWithBus.setContext(context);

      // Wait for debounce and validation
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(validationFailed).toBe(true);
    });
  });

  describe("Singleton", () => {
    it("should return same instance on subsequent calls", () => {
      const store1 = getActiveContextStore();
      const store2 = getActiveContextStore();

      expect(store1).toBe(store2);
    });

    it("should reset singleton", () => {
      const store1 = getActiveContextStore();
      resetActiveContextStore();
      const store2 = getActiveContextStore();

      expect(store1).not.toBe(store2);
    });
  });

  describe("Listener Management", () => {
    it("should track listener count", () => {
      expect(store.getListenerCount()).toBe(0);

      const unsub1 = store.onContextChange(() => {});
      expect(store.getListenerCount()).toBe(1);

      const unsub2 = store.onContextChange(() => {});
      expect(store.getListenerCount()).toBe(2);

      unsub1();
      expect(store.getListenerCount()).toBe(1);

      unsub2();
      expect(store.getListenerCount()).toBe(0);
    });
  });
});
