/**
 * @helios/desktop — Desktop shell entry point for heliosApp.
 *
 * Creates the ElectroBun window and initializes the terminal surface.
 * Cross-workspace import from @helios/runtime validates path alias resolution.
 */

import { healthCheck, VERSION, type HealthCheckResult } from "@helios/runtime";
import { InMemoryLocalBus } from "../../runtime/src/protocol/bus/emitter.js";
import type { LocalBus } from "../../runtime/src/protocol/bus.js";
import {
  ActiveContextStore,
  selectActiveContext,
  INITIAL_ACTIVE_CONTEXT_STATE,
  type ActiveTab,
} from "./context_store.js";
import { DesktopRuntimeClient } from "./runtime_client.js";
import {
  type DesktopSettings,
  DEFAULT_SETTINGS,
  type RendererEngine,
  switchRendererWithRollback,
} from "./settings.js";
import { type TabSurface, buildAllTabSurfaces } from "./tabs.js";

function main(): void {
  const health: HealthCheckResult = healthCheck();

  console.log(`[helios-desktop] runtime v${VERSION}`);
  console.log(
    `[helios-desktop] health: ok=${String(health.ok)} uptime=${health.uptimeMs.toFixed(1)}ms`
  );

  // ElectroBun window creation will be wired in spec 001 WP00.
  // For now, confirm the monorepo cross-workspace import works.
  console.log("[helios-desktop] monorepo workspace resolution: OK");
}

main();

export type BootDesktopInput = {
  bus?: LocalBus;
  initialSettings?: DesktopSettings;
};

export class EditorlessControlPlane {
  readonly store: ActiveContextStore;
  readonly runtimeClient: DesktopRuntimeClient;
  private settings: DesktopSettings;

  constructor(input: BootDesktopInput = {}) {
    const bus = input.bus ?? new InMemoryLocalBus();
    this.store = new ActiveContextStore(INITIAL_ACTIVE_CONTEXT_STATE);
    this.runtimeClient = new DesktopRuntimeClient(bus);
    this.settings = input.initialSettings ?? DEFAULT_SETTINGS;
  }

  getSettings(): DesktopSettings {
    return this.settings;
  }

  getActiveContext() {
    return selectActiveContext(this.store.getState());
  }

  getTab(tab: ActiveTab): TabSurface {
    return buildAllTabSurfaces(this.store.getState())[tab];
  }

  getTabs(): Record<ActiveTab, TabSurface> {
    return buildAllTabSurfaces(this.store.getState());
  }

  setWorkspace(workspaceId: string): void {
    this.store.dispatch({ type: "workspace.set", workspaceId });
  }

  setActiveTab(tab: ActiveTab): void {
    this.store.dispatch({ type: "tab.set", tab });
  }

  async createLane(input: {
    workspaceId: string;
    preferredTransport?: string;
    simulateDegrade?: boolean;
    forceError?: boolean;
  }): Promise<{ ok: boolean; laneId: string | null; error: string | null }> {
    this.store.dispatch({ type: "operation.start", operation: "lane" });
    this.store.dispatch({
      type: "workspace.set",
      workspaceId: input.workspaceId,
    });

    const result = await this.runtimeClient.createLane(input);
    this.store.dispatch({
      type: "diagnostics.set",
      diagnostics: result.diagnostics,
    });

    if (!(result.ok && result.id)) {
      this.store.dispatch({
        type: "operation.failure",
        operation: "lane",
        error: result.error ?? "lane create failed",
      });
      return {
        ok: false,
        laneId: null,
        error: result.error ?? "lane create failed",
      };
    }

    this.store.dispatch({ type: "lane.set", laneId: result.id });
    if (result.runtimeState) {
      this.store.dispatch({
        type: "runtime.state.set",
        runtimeState: result.runtimeState,
      });
    }
    this.store.dispatch({ type: "operation.success", operation: "lane" });
    return { ok: true, laneId: result.id, error: null };
  }

  async ensureSession(input: {
    workspaceId: string;
    laneId: string;
    forceError?: boolean;
  }): Promise<{ ok: boolean; sessionId: string | null; error: string | null }> {
    this.store.dispatch({ type: "operation.start", operation: "session" });
    const result = await this.runtimeClient.ensureSession(input);
    this.store.dispatch({
      type: "diagnostics.set",
      diagnostics: result.diagnostics,
    });

    if (!(result.ok && result.id)) {
      this.store.dispatch({
        type: "operation.failure",
        operation: "session",
        error: result.error ?? "session attach failed",
      });
      return {
        ok: false,
        sessionId: null,
        error: result.error ?? "session attach failed",
      };
    }

    this.store.dispatch({ type: "session.set", sessionId: result.id });
    if (result.runtimeState) {
      this.store.dispatch({
        type: "runtime.state.set",
        runtimeState: result.runtimeState,
      });
    }
    this.store.dispatch({ type: "operation.success", operation: "session" });
    return { ok: true, sessionId: result.id, error: null };
  }

  async restoreSession(input: {
    workspaceId: string;
    laneId: string;
    sessionId?: string;
    forceError?: boolean;
  }): Promise<{ ok: boolean; sessionId: string | null; error: string | null }> {
    this.store.dispatch({ type: "operation.start", operation: "session" });
    const result = await this.runtimeClient.ensureSession({
      workspaceId: input.workspaceId,
      laneId: input.laneId,
      restore: true,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.forceError !== undefined ? { forceError: input.forceError } : {}),
    });

    if (!(result.ok && result.id)) {
      this.store.dispatch({
        type: "operation.failure",
        operation: "session",
        error: result.error ?? "session restore failed",
      });
      return {
        ok: false,
        sessionId: null,
        error: result.error ?? "session restore failed",
      };
    }

    this.store.dispatch({ type: "lane.set", laneId: input.laneId });
    this.store.dispatch({ type: "session.set", sessionId: result.id });
    if (result.runtimeState) {
      this.store.dispatch({
        type: "runtime.state.set",
        runtimeState: result.runtimeState,
      });
    }
    this.store.dispatch({ type: "operation.success", operation: "session" });
    return { ok: true, sessionId: result.id, error: null };
  }

  async spawnTerminal(input: {
    workspaceId: string;
    laneId: string;
    sessionId: string;
    forceError?: boolean;
  }): Promise<{
    ok: boolean;
    terminalId: string | null;
    error: string | null;
  }> {
    this.store.dispatch({ type: "operation.start", operation: "terminal" });
    const result = await this.runtimeClient.spawnTerminal(input);
    if (!(result.ok && result.id)) {
      this.store.dispatch({
        type: "operation.failure",
        operation: "terminal",
        error: result.error ?? "terminal spawn failed",
      });
      return {
        ok: false,
        terminalId: null,
        error: result.error ?? "terminal spawn failed",
      };
    }

    this.store.dispatch({ type: "terminal.set", terminalId: result.id });
    if (result.runtimeState) {
      this.store.dispatch({
        type: "runtime.state.set",
        runtimeState: result.runtimeState,
      });
    }
    this.store.dispatch({ type: "operation.success", operation: "terminal" });
    return { ok: true, terminalId: result.id, error: null };
  }

  async switchRenderer(
    targetEngine: RendererEngine,
    options?: {
      forceError?: boolean;
      forceRollbackError?: boolean;
    }
  ): Promise<{
    committed: boolean;
    rolledBack: boolean;
    message: string;
    activeEngine: RendererEngine;
  }> {
    const outcome = await switchRendererWithRollback({
      settings: this.settings,
      targetEngine,
      runtimeClient: this.runtimeClient,
      contextStore: this.store,
      forceError: options?.forceError ?? false,
      forceRollbackError: options?.forceRollbackError ?? false,
    });
    this.settings = outcome.settings;
    return {
      committed: outcome.committed,
      rolledBack: outcome.rolledBack,
      message: outcome.message,
      activeEngine: this.settings.rendererEngine,
    };
  }
}

export function bootDesktop(input: BootDesktopInput = {}) {
  return new EditorlessControlPlane(input);
}

export function renderTabSnapshot(surface: TabSurface): string {
  return [
    `<section data-testid="tab-${surface.tab}" data-state="${surface.state}">`,
    `<h2>${surface.title}</h2>`,
    `<p data-testid="tab-${surface.tab}-message">${surface.message}</p>`,
    `<p data-testid="tab-${surface.tab}-workspace">${surface.context.workspaceId ?? "none"}</p>`,
    `<p data-testid="tab-${surface.tab}-lane">${surface.context.laneId ?? "none"}</p>`,
    `<p data-testid="tab-${surface.tab}-session">${surface.context.sessionId ?? "none"}</p>`,
    `<p data-testid="tab-${surface.tab}-transport">${surface.diagnostics.resolvedTransport}</p>`,
    `<p data-testid="tab-${surface.tab}-degrade">${surface.diagnostics.degradedReason ?? "none"}</p>`,
    "</section>",
  ].join("");
}

export function renderControlPlaneSnapshot(controlPlane: EditorlessControlPlane): string {
  const tabs = controlPlane.getTabs();
  const settings = controlPlane.getSettings();
  return [
    "<main>",
    `<p data-testid="renderer-engine">${settings.rendererEngine}</p>`,
    `<p data-testid="renderer-switch-status">${controlPlane.store.getState().rendererSwitch.lastStatus}</p>`,
    renderTabSnapshot(tabs.terminal),
    renderTabSnapshot(tabs.agent),
    renderTabSnapshot(tabs.session),
    renderTabSnapshot(tabs.chat),
    renderTabSnapshot(tabs.project),
    "</main>",
  ].join("");
}
