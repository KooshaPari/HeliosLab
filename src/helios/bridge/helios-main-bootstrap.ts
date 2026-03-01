/**
 * Helios Main-Process Bootstrap
 *
 * Initializes the helios runtime (LocalBus, boundary dispatcher, RPC bridge,
 * persistence) in the ElectroBun main process.
 */

import { InMemoryLocalBus } from "../runtime/protocol/bus";
import { createBusRpcBridge, type BusRpcBridge } from "./bus-rpc-bridge";
import { loadSettings, type HeliosSettings } from "./persistence";
import { RuntimeMetrics } from "../runtime/diagnostics/metrics";
import { HeliosTerminalBridge } from "./terminal-bridge";
import { createToolDispatch } from "./tool-dispatch";
import { createA2ADispatch } from "./a2a-dispatch";

export interface HeliosRuntime {
  bus: InstanceType<typeof InMemoryLocalBus>;
  bridge: BusRpcBridge;
  settings: HeliosSettings;
  metrics: RuntimeMetrics;
  termBridge: HeliosTerminalBridge;
  dispose(): void;
}

let instance: HeliosRuntime | null = null;

/**
 * Bootstrap the helios runtime for a workspace.
 * Idempotent — returns the existing instance if already bootstrapped.
 *
 * @param {string} workspaceId The ID of the workspace to bootstrap
 * @param {string} [windowId] Optional ID of the window initializing the runtime
 * @returns {HeliosRuntime} A HeliosRuntime instance
 */
export function bootstrapHelios(workspaceId: string, windowId?: string): HeliosRuntime {
  if (instance) {return instance;}

  const bus = new InMemoryLocalBus();
  const metrics = new RuntimeMetrics();
  const termBridge = new HeliosTerminalBridge();
  const settings = loadSettings();

  const bridge = createBusRpcBridge({
    bus,
    workspaceId,
    dispatchTool: createToolDispatch(),
    dispatchA2A: createA2ADispatch(),
    metrics,
    termBridge,
    windowId,
  });

  instance = {
    bus,
    bridge,
    settings,
    metrics,
    termBridge,
    dispose() {
      bridge.dispose();
      termBridge.dispose();
      instance = null;
    },
  };

  console.log(
    `[helios] runtime bootstrapped for workspace ${workspaceId} (renderer: ${settings.rendererEngine})`,
  );
  return instance;
}

/**
 * Get the current helios runtime instance, if bootstrapped.
 *
 * @returns {HeliosRuntime|null} The HeliosRuntime instance if bootstrapped, null otherwise
 */
export function getHeliosRuntime(): HeliosRuntime | null {
  return instance;
}
