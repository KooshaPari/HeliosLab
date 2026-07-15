// FR-001: Local Bus Decoupled Dispatch (control plane boots with ILocalBusPort adapter)
// FR-002: Command Correlation Guarantee (control plane commands must receive correlated responses)
// Traces to: ILocalBusPort (primary port), IWorkspacePort (workspace boot)
import { describe, expect, test } from "bun:test";
import { createRuntime } from "../../../runtime/src/index.js";
import { bootDesktop } from "../../src/index.js";

describe("EditorlessControlPlane", () => {
  test("wires lane/session/terminal actions and keeps context in sync", async () => {
    const runtime = createRuntime();
    const controlPlane = bootDesktop({ bus: runtime.bus });

    const laneResult = await controlPlane.createLane({
      workspaceId: "workspace_alpha",
      simulateDegrade: true,
    });
    expect(laneResult.ok).toBe(true);

    const laneId = laneResult.laneId as string;
    const sessionResult = await controlPlane.ensureSession({
      workspaceId: "workspace_alpha",
      laneId,
    });
    expect(sessionResult.ok).toBe(true);

    const sessionId = sessionResult.sessionId as string;
    const terminalResult = await controlPlane.spawnTerminal({
      workspaceId: "workspace_alpha",
      laneId,
      sessionId,
    });
    expect(terminalResult.ok).toBe(true);

    controlPlane.setActiveTab("chat");
    controlPlane.setActiveTab("project");

    const tabs = controlPlane.getTabs();
    expect(tabs.terminal.context.laneId).toBe(laneId);
    expect(tabs.agent.context.sessionId).toBe(sessionId);
    expect(tabs.project.context.terminalId).toBe(terminalResult.terminalId);
    expect(tabs.chat.diagnostics.resolvedTransport).toBe("cliproxy_harness");
    expect(tabs.chat.diagnostics.degradedReason).toBeNull();
  });
});
