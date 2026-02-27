/**
 * Helios Main-Process Bootstrap
 *
 * Initializes the helios runtime (LocalBus, control plane, RPC bridge)
 * in the ElectroBun main process. Called from src/main/index.ts when
 * HELIOS_SURFACE_EDITOR is not "true".
 */

import { InMemoryLocalBus } from "../runtime/protocol/bus";
import { createBusRpcBridge, type BusRpcBridge } from "./bus-rpc-bridge";

export type HeliosRuntime = {
  bus: InstanceType<typeof InMemoryLocalBus>;
  bridge: BusRpcBridge;
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

  instance = {
    bus,
    bridge,
    dispose() {
      bridge.dispose();
      instance = null;
    },
  };

  console.log(`[helios] runtime bootstrapped for workspace ${workspaceId}`);
  return instance;
}

/** Get the current helios runtime instance, if bootstrapped */
export function getHeliosRuntime(): HeliosRuntime | null {
  return instance;
}
