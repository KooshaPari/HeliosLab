import { describe, expect, test } from "bun:test";
import { createRuntime } from "../../../runtime/src";
import { bootDesktop } from "../../src";

// Traces to: FR-TXN-001 (atomic transactions), FR-TXN-004 (rollback on failure), FR-TXN-006 (context preservation)
describe("renderer switch transaction", () => {
  test("rolls back to previous renderer on switch failure and keeps active context", async () => {
    const runtime = createRuntime();
    const controlPlane = bootDesktop({ bus: runtime.bus });
    controlPlane.setWorkspace("ws_renderer");

    const laneResult = await controlPlane.createLane({
      workspaceId: "ws_renderer",
    });
    const sessionResult = await controlPlane.ensureSession({
      workspaceId: "ws_renderer",
      laneId: laneResult.laneId as string,
    });
    await controlPlane.spawnTerminal({
      workspaceId: "ws_renderer",
      laneId: laneResult.laneId as string,
      sessionId: sessionResult.sessionId as string,
    });

    const beforeSwitch = controlPlane.getActiveContext();
    const outcome = await controlPlane.switchRenderer("rio", {
      forceError: true,
    });
    const afterSwitch = controlPlane.getActiveContext();

    expect(outcome.committed).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.activeEngine).toBe("ghostty");
    expect(afterSwitch).toEqual(beforeSwitch);
    expect(controlPlane.store.getState().rendererSwitch.lastStatus).toBe("rolled_back");
  });
});
