import { beforeEach, describe, expect, it } from "bun:test";
import { AgentTab } from "../../../src/tabs/agent_tab";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("AgentTab", () => {
	let tab: AgentTab;

	beforeEach(() => {
		tab = new AgentTab();
	});

	describe("Initialization", () => {
		it("should create with correct properties", () => {
			expect(tab.getTabId()).toBe("agent-tab");
			expect(tab.getTabType()).toBe("agent");
			expect(tab.getLabel()).toBe("Agent");
		});
	});

	describe("Context Binding", () => {
		it("should update on context change", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const el = tab.render();
			expect(el.textContent).toContain("Agent Status");
		});

		it("should show empty state on null context", async () => {
			await tab.onContextChange(null);
			const el = tab.render();
			expect(el.textContent).toContain("No agent activity");
		});
	});

	describe("Status Display", () => {
		it("should display agent status indicator", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const el = tab.render();

			expect(el.textContent).toContain("IDLE");
		});

		it("should show action history", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const el = tab.render();

			expect(el.textContent).toContain("Initialize session");
		});
	});

	describe("Actions", () => {
		it("should have action buttons", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const el = tab.render();
			const buttons = el.querySelectorAll("button");

			expect(buttons.length).toBeGreaterThan(0);
			expect(
				Array.from(buttons).some((b) => b.textContent?.includes("Restart")),
			).toBe(true);
		});
	});

	describe("State Persistence", () => {
		it("should serialize state", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const state = tab.getState();

			expect(state.tabType).toBe("agent");
			expect(state.agentStatus).toBe("idle");
		});

		it("should restore state", async () => {
			const context: ActiveContext = {
				workspaceId: "ws1",
				laneId: "lane1",
				sessionId: "session1",
			};

			await tab.onContextChange(context);
			const originalState = tab.getState();

			const newTab = new AgentTab();
			newTab.restoreState(originalState);

			expect(newTab.getState().tabType).toBe(originalState.tabType);
		});
	});

	describe("Lifecycle", () => {
		it("should handle activation and deactivation", () => {
			tab.onActivate();
			expect(tab.getIsActive()).toBe(true);

			tab.onDeactivate();
			expect(tab.getIsActive()).toBe(false);
		});
	});
});
