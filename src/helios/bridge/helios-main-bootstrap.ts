/**
 * Helios Main-Process Bootstrap
 *
 * Initializes the helios runtime (LocalBus, boundary dispatcher, RPC bridge,
 * persistence) in the ElectroBun main process.
 */

import { InMemoryLocalBus } from "../runtime/protocol/bus";
import { createBusRpcBridge, type BusRpcBridge } from "./bus-rpc-bridge";
import { loadSettings, type HeliosSettings } from "./persistence";

export type HeliosRuntime = {
  bus: InstanceType<typeof InMemoryLocalBus>;
  bridge: BusRpcBridge;
  settings: HeliosSettings;
  dispose(): void;
};

let instance: HeliosRuntime | null = null;

/**
 * Bootstrap the helios runtime for a workspace.
 * Idempotent — returns the existing instance if already bootstrapped.
 */
export function bootstrapHelios(workspaceId: string): HeliosRuntime {
  if (instance) return instance;

  const bus = new InMemoryLocalBus();
  const bridge = createBusRpcBridge(bus, workspaceId);
  const settings = loadSettings();

  instance = {
    bus,
    bridge,
    settings,
    dispose() {
      bridge.dispose();
      instance = null;
    },
  };

  console.log(`[helios] runtime bootstrapped for workspace ${workspaceId} (renderer: ${settings.rendererEngine})`);
  return instance;
}

/** Get the current helios runtime instance, if bootstrapped */
export function getHeliosRuntime(): HeliosRuntime | null {
  return instance;
}
