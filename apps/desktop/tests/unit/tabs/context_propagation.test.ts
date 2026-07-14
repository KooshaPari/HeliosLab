import {
  ContextPropagator,
  resetContextPropagator,
} from "../../../src/tabs/context_switch_propagation";
import { createMockTabSurface } from "../../../src/tabs/tab_surface";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("ContextPropagator", () => {
  let propagator: ContextPropagator;
  let mockTabs: ReturnType<typeof createMockTabSurface>[] = [];

  beforeEach(() => {
    resetContextPropagator();
    propagator = new ContextPropagator();

    mockTabs = [
      createMockTabSurface("tab1", "terminal", "Terminal"),
      createMockTabSurface("tab2", "agent", "Agent"),
      createMockTabSurface("tab3", "session", "Session"),
    ];

    for (const tab of mockTabs) {
      propagator.registerTab(tab);
    }
  });

  afterEach(() => {
    resetContextPropagator();
  });

  describe("Tab Registration", () => {
    it("should register tabs", () => {
      expect(propagator.getTabCount()).toBe(3);
    });

    it("should unregister tabs", () => {
      propagator.unregisterTab("tab1");
      expect(propagator.getTabCount()).toBe(2);
    });

    it("should clear all tabs", () => {
      propagator.clearAllTabs();
      expect(propagator.getTabCount()).toBe(0);
    });
  });

  describe("Context Propagation", () => {
    it("should propagate context to all tabs", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.successful.length).toBeGreaterThan(0);
      expect(result.failed.length).toBe(0);
      expect(result.timed_out.length).toBe(0);
    });

    it("should track propagation duration", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("should propagate null context", async () => {
      const result = await propagator.propagateContext(null);

      expect(result.successful.length).toBe(mockTabs.length);
    });
  });

  describe("Failure Handling", () => {
    it("should track failed propagations", async () => {
      const failingTab = mockTabs[0];

      // Make the tab's onContextChange throw an error
      failingTab.onContextChange = async () => {
        throw new Error("Context change failed");
      };

      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.failed.length).toBeGreaterThan(0);
    });

    it("should track timeout propagations", async () => {
      const slowTab = mockTabs[0];

      // Make the tab's onContextChange very slow
      slowTab.onContextChange = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      };

      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.timed_out.length).toBeGreaterThan(0);
    });
  });

  describe("Propagation Cancellation", () => {
    it("should cancel previous propagation on new context", async () => {
      const slowTab = mockTabs[0];
      let _callCount = 0;

      slowTab.onContextChange = async () => {
        _callCount++;
        await new Promise(resolve => setTimeout(resolve, 200));
      };

      const context1: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const context2: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane2",
        sessionId: "session1",
      };

      // Start first propagation
      const _promise1 = propagator.propagateContext(context1);

      // Immediately start second propagation (should cancel first)
      await new Promise(resolve => setTimeout(resolve, 50));
      const promise2 = propagator.propagateContext(context2);

      // Second propagation should complete
      const result = await promise2;
      expect(result.successful.length).toBeGreaterThan(0);
    });
  });

  describe("Mixed Results", () => {
    it("should handle mixed success and failure", async () => {
      mockTabs[0].onContextChange = async () => {
        throw new Error("Failed");
      };

      mockTabs[1].onContextChange = async () => {
        // Success
      };

      mockTabs[2].onContextChange = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      };

      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.successful.length).toBe(1);
      expect(result.failed.length).toBe(1);
      expect(result.timed_out.length).toBe(1);
    });
  });

  describe("Empty Propagation", () => {
    it("should handle propagation with no tabs", async () => {
      propagator.clearAllTabs();

      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const result = await propagator.propagateContext(context);

      expect(result.successful.length).toBe(0);
      expect(result.failed.length).toBe(0);
    });
  });
});
