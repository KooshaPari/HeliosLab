/**
 * Webflow Plugin - Renderer Entry Point
 *
 * This file is dynamically imported by the main app to register
 * plugin-specific renderer components (slates, settings, etc.)
 */

import { WebflowSlate } from "./WebflowSlate";
import WebflowTokenManager from "./WebflowTokenManager";

// Types for the registration API provided by the main app
interface SlateComponentProps {
  node?: any;
  slateInfo: any;
  instanceId: string;
}

type SlateComponent = (props: SlateComponentProps) => any;
type SettingsComponent = (props: any) => any;

interface PluginRendererAPI {
  registerSlateComponent: (slateId: string, component: SlateComponent) => void;
  registerSettingsComponent: (componentId: string, component: SettingsComponent) => void;
}

/**
 * Called by the main app to initialize this plugin's renderer components.
 * @param api - Registration API provided by the main app
 */
export function initializeRenderer(api: PluginRendererAPI): void {
  // Register slate components
  api.registerSlateComponent("colab-webflow.devlink-project", (props) => {
    return (
      <WebflowSlate
        node={props.node}
        slateType="devlink"
      />
    );
  });

  api.registerSlateComponent("colab-webflow.code-components", (props) => {
    return (
      <WebflowSlate
        node={props.node}
        slateType="code-components"
      />
    );
  });

  api.registerSlateComponent("colab-webflow.dashboard", (props) => {
    return (
      <WebflowSlate
        node={props.node}
        slateType="dashboard"
      />
    );
  });

  api.registerSlateComponent("colab-webflow.cloud", (props) => {
    return (
      <WebflowSlate
        node={props.node}
        slateType="cloud"
      />
    );
  });

  // Register settings components
  api.registerSettingsComponent("webflow-tokens", WebflowTokenManager);

  console.log("[colab-webflow] Renderer components registered");
}
