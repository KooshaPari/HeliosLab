import type { ActiveContextStore } from "./context_store";
import { selectActiveContext } from "./context_store";
import type { DesktopRuntimeClient } from "./runtime_client";

export type RendererEngine = "ghostty" | "rio";

export type DesktopSettings = {
  rendererEngine: RendererEngine;
  hotSwapPreferred: boolean;
};

export const DEFAULT_SETTINGS: DesktopSettings = {
  rendererEngine: "ghostty",
  hotSwapPreferred: true,
};

export type SwitchRendererInput = {
  settings: DesktopSettings;
  targetEngine: RendererEngine;
  runtimeClient: DesktopRuntimeClient;
  contextStore: ActiveContextStore;
  forceError?: boolean;
  forceRollbackError?: boolean;
};

export type SwitchRendererOutcome = {
  settings: DesktopSettings;
  committed: boolean;
  rolledBack: boolean;
  message: string;
};

export async function switchRendererWithRollback(
  input: SwitchRendererInput,
): Promise<SwitchRendererOutcome> {
  const previousEngine = input.settings.rendererEngine;
  const snapshot = selectActiveContext(input.contextStore.getState());

  input.contextStore.dispatch({
    type: "renderer.switch.started",
    previousEngine,
    targetEngine: input.targetEngine,
  });

  const switchResult = await input.runtimeClient.switchRenderer({
    workspaceId: snapshot.workspaceId,
    targetEngine: input.targetEngine,
    forceError: input.forceError,
  });

  if (switchResult.ok) {
    input.contextStore.dispatch({
      type: "renderer.switch.succeeded",
      targetEngine: switchResult.activeEngine,
    });

    return {
      settings: {
        ...input.settings,
        rendererEngine: switchResult.activeEngine,
      },
      committed: true,
      rolledBack: false,
      message: `renderer switched to ${switchResult.activeEngine}`,
    };
  }

  input.contextStore.dispatch({
    type: "renderer.switch.failed",
    message: switchResult.error ?? "renderer switch failed",
  });

  const rollbackResult = await input.runtimeClient.switchRenderer({
    workspaceId: snapshot.workspaceId,
    targetEngine: previousEngine,
    forceError: input.forceRollbackError,
  });

  if (rollbackResult.ok) {
    input.contextStore.dispatch({
      type: "renderer.switch.rolled_back",
      engine: previousEngine,
      message: `renderer rollback to ${previousEngine} applied`,
    });

    return {
      settings: { ...input.settings, rendererEngine: previousEngine },
      committed: false,
      rolledBack: true,
      message: `renderer switch failed; rolled back to ${previousEngine}`,
    };
  }

  input.contextStore.dispatch({
    type: "renderer.switch.failed",
    message: `renderer switch failed; rollback failed (${rollbackResult.error ?? "unknown"})`,
  });

  return {
    settings: { ...input.settings, rendererEngine: previousEngine },
    committed: false,
    rolledBack: false,
    message: `renderer switch and rollback failed (${rollbackResult.error ?? "unknown"})`,
  };
}
