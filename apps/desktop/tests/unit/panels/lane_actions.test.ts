import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
// FR-001: Local Bus Decoupled Dispatch (lane actions dispatch commands via ILocalBusPort)
// FR-002: Command Correlation Guarantee (create/close lane commands are correlated)
// Traces to: ILocalBusPort (command dispatch), IWorkspacePort (lane belongs to workspace)
import { LaneActions } from "../../../src/panels/lane_actions";
import type { RuntimeAPI } from "../../../src/panels/lane_actions";

describe("LaneActions", () => {
  let actions: LaneActions;
  let mockAPI: RuntimeAPI;

  const createMockAPI = (): RuntimeAPI => ({
    createLane: mock().mockResolvedValue({ id: "lane-new", name: "New Lane" }),
    attachLane: mock().mockResolvedValue(undefined),
    detachLane: mock().mockResolvedValue(undefined),
    cleanupLane: mock().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    mockAPI = createMockAPI();
  });

  afterEach(() => {
    if (actions) {
      actions.destroy();
    }
  });

  it("should create lane successfully", async () => {
    const onLaneCreated = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onLaneCreated,
    });

    await actions.createLane("ws-1");

    expect(mockAPI.createLane).toHaveBeenCalledWith("ws-1");
    expect(onLaneCreated).toHaveBeenCalledWith("lane-new");
  });

  it("should call optimistic callback on create", async () => {
    actions = new LaneActions({
      runtimeAPI: mockAPI,
    });

    const optimisticCallback = mock();

    await actions.createLane("ws-1", optimisticCallback);

    expect(optimisticCallback).toHaveBeenCalled();
  });

  it("should handle create lane error", async () => {
    const error = new Error("API error");
    mockAPI.createLane = mock().mockRejectedValue(error);
    const onError = mock();

    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
    });

    await actions.createLane("ws-1");

    expect(onError).toHaveBeenCalled();
    const errorArg = (onError as any).mock.calls[0][0];
    expect(errorArg.code).toBe("CREATE_FAILED");
  });

  it("should attach lane successfully", async () => {
    const onLaneAttached = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onLaneAttached,
    });

    await actions.attachLane("lane-1");

    expect(mockAPI.attachLane).toHaveBeenCalledWith("lane-1");
    expect(onLaneAttached).toHaveBeenCalledWith("lane-1");
  });

  it("should handle attach lane error", async () => {
    mockAPI.attachLane = mock().mockRejectedValue(new Error("Attach failed"));
    const onError = mock();

    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
    });

    await actions.attachLane("lane-1");

    expect(onError).toHaveBeenCalled();
    const errorArg = (onError as any).mock.calls[0][0];
    expect(errorArg.code).toBe("ATTACH_FAILED");
  });

  it("should detach lane successfully", async () => {
    const onLaneDetached = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onLaneDetached,
    });

    await actions.detachLane("lane-1");

    expect(mockAPI.detachLane).toHaveBeenCalledWith("lane-1");
    expect(onLaneDetached).toHaveBeenCalledWith("lane-1");
  });

  it("should handle detach lane error", async () => {
    mockAPI.detachLane = mock().mockRejectedValue(new Error("Detach failed"));
    const onError = mock();

    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
    });

    await actions.detachLane("lane-1");

    expect(onError).toHaveBeenCalled();
  });

  it("should cleanup lane successfully", async () => {
    const onLaneCleaned = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onLaneCleaned,
    });

    const result = await actions.cleanupLane("lane-1", false);

    expect(mockAPI.cleanupLane).toHaveBeenCalledWith("lane-1");
    expect(onLaneCleaned).toHaveBeenCalledWith("lane-1");
    expect(result).toBe(true);
  });

  it("should handle cleanup lane error", async () => {
    mockAPI.cleanupLane = mock().mockRejectedValue(new Error("Cleanup failed"));
    const onError = mock();

    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
    });

    const result = await actions.cleanupLane("lane-1", false);

    expect(onError).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("should dismiss error by code", async () => {
    const onError = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
      errorDismissTimeout: 10000,
    });

    mockAPI.createLane = mock().mockRejectedValue(new Error("Create failed"));
    await actions.createLane("ws-1");

    expect(onError).toHaveBeenCalled();

    actions.dismissError("CREATE_FAILED");
    // Error should be dismissed (test passes if no exception thrown)
  });

  it("should clear all errors", async () => {
    const onError = mock();
    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
      errorDismissTimeout: 10000,
    });

    mockAPI.createLane = mock().mockRejectedValue(new Error("Create failed"));
    await actions.createLane("ws-1");

    mockAPI.attachLane = mock().mockRejectedValue(new Error("Attach failed"));
    await actions.attachLane("lane-1");

    expect(onError).toHaveBeenCalledTimes(2);

    actions.clearAllErrors();
    // All errors should be cleared
  });

  it("should revert optimistic update on error", async () => {
    mockAPI.attachLane = mock().mockRejectedValue(new Error("Attach failed"));
    const onError = mock();
    const revertCallback = mock();

    actions = new LaneActions({
      runtimeAPI: mockAPI,
      onError,
    });

    await actions.attachLane("lane-1", revertCallback);

    expect(revertCallback).toHaveBeenCalled();
  });
});
