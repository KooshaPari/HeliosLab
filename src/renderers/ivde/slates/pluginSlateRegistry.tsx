/**
 * Plugin Slate Registry
 *
 * This module manages dynamic registration of plugin renderer components.
 * Plugins provide their own renderer entry points that register slates and settings.
 */

import { registerSlateComponent, unregisterSlateComponent } from "./PluginSlate";

// Settings component registry
type SettingsComponent = (props: any) => any;
const settingsComponentRegistry = new Map<string, SettingsComponent>();

export function registerSettingsComponent(componentId: string, component: SettingsComponent): void {
  settingsComponentRegistry.set(componentId, component);
  console.log(`[pluginSlateRegistry] Registered settings component: ${componentId}`);
}

export function unregisterSettingsComponent(componentId: string): void {
  settingsComponentRegistry.delete(componentId);
}

export function getSettingsComponent(componentId: string): SettingsComponent | undefined {
  return settingsComponentRegistry.get(componentId);
}

// API provided to plugin renderers
const pluginRendererAPI = {
  registerSlateComponent,
  registerSettingsComponent,
};

// Track loaded plugins to avoid duplicate initialization
const loadedPlugins = new Set<string>();

// Promise that resolves when initial plugin renderers are loaded
let renderersReadyResolve: (() => void) | null = null;
let renderersReady = false;
const renderersReadyPromise = new Promise<void>((resolve) => {
  renderersReadyResolve = resolve;
});

/**
 * Wait for plugin renderers to be initialized.
 * Use this to delay rendering until components are registered.
 */
export function waitForPluginRenderers(): Promise<void> {
  if (renderersReady) {
    return Promise.resolve();
  }
  return renderersReadyPromise;
}

/**
 * Check if plugin renderers have been initialized
 */
export function arePluginRenderersReady(): boolean {
  return renderersReady;
}

/**
 * Mapping of plugin names to their renderer module paths.
 * This is the only place where plugin renderer paths are configured.
 */
const pluginRendererPaths: Record<
  string,
  () => Promise<{ initializeRenderer: (api: typeof pluginRendererAPI) => void }>
> = {
  "colab-webflow": () => import("../../../../webflow-plugin/src/renderer/index"),
};

/**
 * Initialize renderer components for a specific plugin.
 * Called when a plugin is detected as installed/active.
 */
export async function initializePluginRenderer(pluginName: string): Promise<void> {
  if (loadedPlugins.has(pluginName)) {
    return; // Already loaded
  }

  const loader = pluginRendererPaths[pluginName];
  if (!loader) {
    // Plugin doesn't have a renderer module (that's OK, not all plugins need one)
    return;
  }

  try {
    const module = await loader();
    if (module.initializeRenderer) {
      module.initializeRenderer(pluginRendererAPI);
      loadedPlugins.add(pluginName);
    }
  } catch (error) {
    console.error(`[pluginSlateRegistry] Failed to load renderer for plugin ${pluginName}:`, error);
  }
}

/**
 * Initialize renderer components for all installed plugins.
 * Call this after plugin slates are loaded from the backend.
 */
export async function initializeAllPluginRenderers(pluginNames: string[]): Promise<void> {
  const uniquePlugins = [...new Set(pluginNames)];
  await Promise.all(uniquePlugins.map((name) => initializePluginRenderer(name)));

  // Mark renderers as ready
  renderersReady = true;
  if (renderersReadyResolve) {
    renderersReadyResolve();
  }
}

/**
 * Legacy function for backwards compatibility.
 * Now just logs that initialization will happen dynamically.
 */
export function initializeSlateRegistry(): void {
  console.log("[pluginSlateRegistry] Registry initialized (plugins will be loaded dynamically)");
}
