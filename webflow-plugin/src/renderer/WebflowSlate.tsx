/**
 * Webflow Slate Component
 *
 * Renders custom UI for Webflow-related config files:
 * - .webflowrc.json (DevLink projects)
 * - webflow.json (Code Components)
 * - .colab.json with type: webflow-cloud (Cloud projects)
 */

import {
  type JSXElement,
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
  createEffect,
} from "solid-js";
import type { PreviewFileTreeType } from "../../../src/shared/types/types";
import { electrobun } from "../../../src/renderers/ivde/init";
import { state, setState, openNewTab, openNewTabForNode } from "../../../src/renderers/ivde/store";
import { join } from "../../../src/renderers/utils/pathUtils";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// Declare the colab-terminal custom element for JSX/TSX
interface ColabTerminalElement extends HTMLElement {
  run(command: string): void;
  write(data: string): void;
  clear(): void;
  kill(): void;
  focus(): void;
  isReady(): boolean;
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "colab-terminal": {
        cwd?: string;
        shell?: string;
        style?: any;
        ref?: (el: ColabTerminalElement) => void;
        // SolidJS uses prop: prefix for properties vs attributes
        "prop:cwd"?: string;
        "prop:shell"?: string;
      };
    }
  }
}

interface WebflowSlateProps {
  node: PreviewFileTreeType | undefined;
  slateType: "devlink" | "code-components" | "cloud" | "dashboard";
}

interface WebflowSite {
  id: string;
  displayName: string;
  shortName: string;
  previewUrl?: string;
  lastPublished?: string;
  lastUpdated?: string;
  createdOn?: string;
}

interface DevLinkConfig {
  siteId?: string;
  siteName?: string;
  componentsPath?: string;
  host?: string;
  authMethod?: string;
}

interface CodeComponentsConfig {
  // New structure with library key
  library?: {
    name: string;
    description?: string;
    id?: string; // Assigned by Webflow after first share
    components: string[];
    bundleConfig?: string;
  };
  // Legacy flat structure (for backwards compatibility)
  name?: string;
  description?: string;
  id?: string;
  version?: string;
  components?: string[];
  workspaceId?: string;
}

interface CloudProjectConfig {
  type: string;
  name: string;
  siteId?: string;
  siteName?: string;
  framework?: string;
  mountPath?: string;
  // Nested cloud config (webflow.json format)
  cloud?: {
    siteId?: string;
    siteName?: string;
    mountPath?: string;
  };
}

const PLUGIN_NAME = "colab-webflow";

export const WebflowSlate = (props: WebflowSlateProps): JSXElement => {
  const [loading, setLoading] = createSignal(true);
  const [connected, setConnected] = createSignal(false);
  const [sites, setSites] = createSignal<WebflowSite[]>([]);
  const [config, setConfig] = createSignal<DevLinkConfig | CodeComponentsConfig | CloudProjectConfig | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [pullRunning, setPullRunning] = createSignal(false);
  const [statusRunning, setStatusRunning] = createSignal(false);
  const [shareRunning, setShareRunning] = createSignal(false);
  const [bundleRunning, setBundleRunning] = createSignal(false);
  const [deployRunning, setDeployRunning] = createSignal(false);
  const [devRunning, setDevRunning] = createSignal(false);
  const [commandOutput, setCommandOutput] = createSignal<string | null>(null);
  const [syncStatus, setSyncStatus] = createSignal<string>("unknown");
  const [lastChecked, setLastChecked] = createSignal<Date | null>(null);

  // Get the project root path (parent of the config file)
  const getProjectRoot = () => {
    if (!props.node?.path) return "";
    const parts = props.node.path.split("/");
    parts.pop(); // Remove filename
    return parts.join("/");
  };

  // Token type from plugin state
  interface StoredToken {
    id: string;
    token: string;
    type: 'oauth' | 'site' | 'workspace';
    status: string;
    siteId?: string;
    workspaceId?: string;
  }

  // Store all tokens so we can pick the right one for different operations
  const [allTokens, setAllTokens] = createSignal<StoredToken[]>([]);

  // Check if plugin is connected (has valid token) and get token
  const checkConnection = async (): Promise<string | null> => {
    try {
      // Check for tokens in plugin state (new OAuth flow)
      const tokens = await electrobun.rpc?.request.pluginGetStateValue({
        pluginName: PLUGIN_NAME,
        key: 'tokens',
      }) as StoredToken[] | undefined;

      console.log('[WebflowSlate] tokens from state:', tokens);

      if (tokens && Array.isArray(tokens)) {
        setAllTokens(tokens.filter(t => t.status === 'valid'));
        const validToken = tokens.find((t) => t.status === 'valid');
        if (validToken?.token) {
          setConnected(true);
          return validToken.token;
        }
      }
      // Fallback to old accessToken setting
      const values = await electrobun.rpc?.request.pluginGetSettingsValues({
        pluginName: PLUGIN_NAME,
      });
      if (values?.accessToken && String(values.accessToken).trim()) {
        setConnected(true);
        return String(values.accessToken);
      }
    } catch (e) {
      console.error("Failed to check Webflow connection:", e);
    }
    return null;
  };

  // Get a workspace-scoped token (for Code Components)
  const getWorkspaceToken = (): string | null => {
    const tokens = allTokens();
    // Prefer workspace or oauth tokens (they have workspace access)
    const workspaceToken = tokens.find(t => t.type === 'workspace' || t.type === 'oauth');
    return workspaceToken?.token || null;
  };

  // Get a site-scoped token (for DevLink)
  const getSiteToken = (siteId?: string): string | null => {
    const tokens = allTokens();
    // If siteId specified, try to find a token for that site
    if (siteId) {
      const siteToken = tokens.find(t => t.type === 'site' && t.siteId === siteId);
      if (siteToken) return siteToken.token;
    }
    // Otherwise return any valid token (oauth/workspace tokens can access sites too)
    return tokens[0]?.token || null;
  };

  // Load sites from plugin state (fetched by the plugin from main process)
  const loadSitesFromState = async () => {
    try {
      const sitesFromState = await electrobun.rpc?.request.pluginGetStateValue({
        pluginName: PLUGIN_NAME,
        key: 'sites',
      }) as WebflowSite[] | undefined;

      console.log('[WebflowSlate] sites from plugin state:', sitesFromState?.length);
      if (sitesFromState && Array.isArray(sitesFromState)) {
        setSites(sitesFromState);
      }
    } catch (e) {
      console.error("[WebflowSlate] Failed to load sites from state:", e);
    }
  };

  // Update config file with new site
  const updateConfigSite = async (site: WebflowSite, token: string) => {
    if (!props.node?.path) {
      console.error('[WebflowSlate] updateConfigSite: no node path');
      return;
    }

    console.log('[WebflowSlate] updateConfigSite:', site.displayName, 'path:', props.node.path);

    try {
      const newConfig = {
        ...(config() || {}),
        siteId: site.id,
        siteName: site.displayName,
        authToken: token,
      };

      const jsonContent = JSON.stringify(newConfig, null, 2);
      console.log('[WebflowSlate] Writing config to:', props.node.path);
      console.log('[WebflowSlate] JSON content:', jsonContent);

      const result = await electrobun.rpc?.request.writeFile({
        path: props.node.path,
        value: jsonContent,
      });

      console.log('[WebflowSlate] writeFile result:', JSON.stringify(result));

      if (result?.success) {
        setConfig(newConfig as any);
        console.log('[WebflowSlate] Config saved successfully');

        // Also create/update webflow.json with the devlink structure the CLI expects
        await ensureWebflowJson(newConfig as DevLinkConfig);
      } else {
        console.error('[WebflowSlate] writeFile failed:', result?.error);
        setError('Failed to save configuration: ' + (result?.error || 'unknown error'));
      }

      // Refresh sync status after changing site
      checkSyncStatus();
    } catch (e) {
      console.error("[WebflowSlate] Failed to update config:", e);
      setError("Failed to update configuration");
    }
  };

  // Create/update webflow.json with the structure the CLI expects
  const ensureWebflowJson = async (cfg: DevLinkConfig) => {
    const projectRoot = getProjectRoot();
    if (!projectRoot) return;

    const webflowJsonPath = projectRoot + '/webflow.json';

    // Read existing webflow.json if it exists
    let existing: any = {};
    try {
      const result = await electrobun.rpc?.request.readFile({ path: webflowJsonPath });
      if (result?.textContent) {
        existing = JSON.parse(result.textContent);
      }
    } catch (e) {
      // File doesn't exist, that's fine
    }

    // Merge with devlink config
    const webflowConfig = {
      ...existing,
      devlink: {
        ...(existing.devlink || {}),
        rootDir: cfg.componentsPath || './devlink',
      },
    };

    await electrobun.rpc?.request.writeFile({
      path: webflowJsonPath,
      value: JSON.stringify(webflowConfig, null, 2),
    });

    console.log('[WebflowSlate] Created/updated webflow.json');
  };

  // Ensure telemetry is pre-configured in webflow.json to skip CLI prompts
  const ensureTelemetryConfig = async (projectRoot: string) => {
    const webflowJsonPath = projectRoot + '/webflow.json';

    // Read existing webflow.json if it exists
    let existing: any = {};
    try {
      const result = await electrobun.rpc?.request.readFile({ path: webflowJsonPath });
      if (result?.textContent) {
        existing = JSON.parse(result.textContent);
      }
    } catch (e) {
      // File doesn't exist, that's fine
    }

    // Check if telemetry is already configured
    if (existing.telemetry?.global?.allowTelemetry !== undefined) {
      return; // Already configured, skip
    }

    // Add telemetry config to skip prompts
    const webflowConfig = {
      ...existing,
      telemetry: {
        ...existing.telemetry,
        global: {
          allowTelemetry: true,
          lastPrompted: Date.now(),
          version: "1.8.49", // Match CLI version
        },
      },
    };

    await electrobun.rpc?.request.writeFile({
      path: webflowJsonPath,
      value: JSON.stringify(webflowConfig, null, 2),
    });

    console.log('[WebflowSlate] Pre-configured telemetry in webflow.json');
  };

  // Load config file content
  const loadConfig = async () => {
    if (!props.node?.path) return;

    try {
      const result = await electrobun.rpc?.request.readFile({
        path: props.node.path,
      });
      if (result?.textContent) {
        const parsed = JSON.parse(result.textContent);
        setConfig(parsed);
      }
    } catch (e) {
      console.error("Failed to read config:", e);
      setError("Failed to read configuration file");
    }
  };

  // Run a terminal command in the project directory
  // Result type from execSpawnSync RPC
  interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }

  const runCommand = async (cmd: string, args: string[]): Promise<string> => {
    const cwd = getProjectRoot();
    if (!cwd) {
      throw new Error("Could not determine project directory");
    }

    try {
      const result = await electrobun.rpc?.request.execSpawnSync({
        cmd,
        args,
        opts: { cwd },
      }) as ExecResult | string;

      // Handle both old string format and new object format
      if (typeof result === "string") {
        setCommandOutput(result);
        return result;
      }

      // Combine stdout and stderr for display
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setCommandOutput(output);

      // If command failed, also set error
      if (result.exitCode !== 0 && result.stderr) {
        setError(result.stderr);
      }

      return output;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      throw e;
    }
  };

  // Run a terminal command with additional environment variables
  const runCommandWithEnv = async (cmd: string, args: string[], env: Record<string, string>): Promise<string> => {
    const cwd = getProjectRoot();
    if (!cwd) {
      throw new Error("Could not determine project directory");
    }

    try {
      const result = await electrobun.rpc?.request.execSpawnSync({
        cmd,
        args,
        opts: { cwd, env },
      }) as ExecResult | string;

      // Handle both old string format and new object format
      if (typeof result === "string") {
        setCommandOutput(result);
        return result;
      }

      // Combine stdout and stderr for display
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setCommandOutput(output);

      // If command failed, also set error
      if (result.exitCode !== 0 && result.stderr) {
        setError(result.stderr);
      }

      return output;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      throw e;
    }
  };

  // Run a terminal command with env vars and stdin input (for answering prompts)
  const runCommandWithEnvAndInput = async (cmd: string, args: string[], env: Record<string, string>, input: string): Promise<string> => {
    const cwd = getProjectRoot();
    if (!cwd) {
      throw new Error("Could not determine project directory");
    }

    try {
      const result = await electrobun.rpc?.request.execSpawnSync({
        cmd,
        args,
        opts: { cwd, env, input },
      }) as ExecResult | string;

      // Handle both old string format and new object format
      if (typeof result === "string") {
        setCommandOutput(result);
        return result;
      }

      // Combine stdout and stderr for display
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setCommandOutput(output);

      // If command failed, also set error
      if (result.exitCode !== 0 && result.stderr) {
        setError(result.stderr);
      }

      return output;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      throw e;
    }
  };

  // Run the wf command (plugin terminal command)
  const runWfCommand = async (subcommand: string, ...args: string[]) => {
    // The 'wf' command is registered by the plugin
    // We can run it via bun/node or directly if it's in PATH
    // For now, use the webflow CLI directly
    return runCommand("bun", ["x", "webflow", ...subcommand.split(" "), ...args]);
  };

  // Open plugin settings panel
  const openSettings = () => {
    setState("settingsPane", {
      type: "plugin-settings",
      data: { pluginName: PLUGIN_NAME }
    });
  };

  // DevLink: Pull components from Webflow
  const pullComponents = async () => {
    setPullRunning(true);
    setCommandOutput(null);
    setError(null);

    const cfg = config() as DevLinkConfig;
    const token = authToken();
    const siteId = cfg?.siteId;

    if (!siteId || !token) {
      setError("Missing site ID or auth token. Please select a site first.");
      setPullRunning(false);
      return;
    }

    try {
      // Ensure webflow.json exists with the devlink config structure
      await ensureWebflowJson(cfg);

      // Run sync with env vars for credentials
      const result = await runCommandWithEnv("bun", [
        "x", "webflow", "devlink", "sync",
      ], {
        WEBFLOW_SITE_ID: siteId,
        WEBFLOW_SITE_API_TOKEN: token,
        // Disable telemetry prompt
        WEBFLOW_TELEMETRY: 'false',
        DO_NOT_TRACK: '1',
      });

      // Check if sync was successful - look for ERROR: prefix which indicates actual errors
      // (not just "error" appearing in log file paths)
      if (result && !result.includes('ERROR:')) {
        setSyncStatus("synced");
      } else {
        setSyncStatus("error");
      }
    } catch (e) {
      setSyncStatus("error");
    } finally {
      setPullRunning(false);
    }
  };

  // DevLink: Check sync status
  const checkSyncStatus = async () => {
    setStatusRunning(true);
    setCommandOutput(null);
    setError(null);

    try {
      const cfg = config() as DevLinkConfig;
      const componentsPath = cfg?.componentsPath || './devlink';
      const projectRoot = getProjectRoot();
      const fullPath = projectRoot + '/' + componentsPath.replace('./', '');

      // Check if the devlink folder exists
      const exists = await electrobun.rpc?.request.exists({ path: fullPath });

      let output = "";
      let localComponentCount = 0;
      let localFiles: string[] = [];

      if (exists) {
        // List files in devlink folder using ls command
        try {
          const lsResult = await electrobun.rpc?.request.execSpawnSync({
            cmd: "ls",
            args: ["-1", fullPath],
            opts: {},
          }) as ExecResult | string | undefined;

          // Handle both old string format and new object format
          const lsOutput = typeof lsResult === 'string' ? lsResult : lsResult?.stdout || '';
          if (lsOutput) {
            const allFiles = lsOutput.split('\n').filter(Boolean);
            localFiles = allFiles.filter(f =>
              f.endsWith('.tsx') || f.endsWith('.jsx') || f.endsWith('.js')
            );
            localComponentCount = localFiles.filter(f =>
              !f.startsWith('index') && !f.startsWith('_')
            ).length;
          }
        } catch (e) {
          console.error('[WebflowSlate] Error listing devlink dir:', e);
        }
      }

      // Get site info for lastPublished date
      const siteId = cfg?.siteId;
      let siteLastPublished: Date | null = null;
      let siteName = cfg?.siteName || 'Unknown';

      if (siteId) {
        const sitesData = sites();
        const site = sitesData.find(s => s.id === siteId);
        if (site) {
          siteName = site.displayName;
          if (site.lastPublished) {
            siteLastPublished = new Date(site.lastPublished);
          }
        }
      }

      // Build status output
      output += `\x1b[1mDevLink Status\x1b[0m\r\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n`;
      output += `Site: ${siteName}\r\n`;
      output += `Path: ${componentsPath}\r\n\r\n`;

      if (!exists) {
        setSyncStatus("needs-sync");
        output += `\x1b[33m⚠ DevLink folder not found.\x1b[0m\r\n`;
        output += `Click "Pull Components" to sync your Webflow components.\r\n`;
      } else if (localComponentCount === 0) {
        setSyncStatus("needs-sync");
        output += `\x1b[33m⚠ No components synced yet.\x1b[0m\r\n`;
        output += `Click "Pull Components" to sync your Webflow components.\r\n`;
      } else {
        output += `\x1b[32m✓ ${localComponentCount} component${localComponentCount !== 1 ? 's' : ''} synced locally\x1b[0m\r\n\r\n`;

        // List first few components
        const componentNames = localFiles
          .filter(f => !f.startsWith('index') && !f.startsWith('_'))
          .slice(0, 8)
          .map(f => f.replace(/\.(tsx|jsx|js)$/, ''));

        if (componentNames.length > 0) {
          output += `Components:\r\n`;
          componentNames.forEach(name => {
            output += `  • ${name}\r\n`;
          });
          if (localComponentCount > 8) {
            output += `  ... and ${localComponentCount - 8} more\r\n`;
          }
        }

        if (siteLastPublished) {
          output += `\r\nSite last published: ${siteLastPublished.toLocaleString()}\r\n`;
          output += `\r\n\x1b[36mTip: Click "Pull Components" to check for updates.\x1b[0m\r\n`;
        }

        setSyncStatus("synced");
      }

      setCommandOutput(output);
      setLastChecked(new Date());
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setSyncStatus("unknown");
      setError(`Failed to check status: ${errMsg}`);
    } finally {
      setStatusRunning(false);
    }
  };

  // Code Components: Share library to Webflow
  // This triggers the main process to run the CLI with browser auth like DevLink does
  const shareLibrary = async () => {
    setCommandOutput(null);
    setError(null);

    // Validate: Library ID is required
    const currentConfig = config() as CodeComponentsConfig | null;
    const libraryId = currentConfig?.library?.id || currentConfig?.id;
    if (!libraryId || !libraryId.trim()) {
      setError("Library ID is required. Please set a Library ID before sharing.");
      return;
    }

    setShareRunning(true);

    // Track the timestamp when we started so we only react to new status updates
    const startTime = Date.now();

    try {
      const cwd = getProjectRoot();
      if (!cwd) {
        throw new Error("Could not determine project directory");
      }

      // First, ensure telemetry is pre-configured in webflow.json to skip prompts
      await ensureTelemetryConfig(cwd);

      setCommandOutput("Starting library share...\nA browser window will open for authentication if needed.");

      // Send message to plugin to run the share command (like startBrowserAuth)
      await electrobun.rpc?.request.pluginSendSettingsMessage({
        pluginName: PLUGIN_NAME,
        message: { type: 'shareLibrary', cwd },
      });

      // Poll plugin state for the result
      let attempts = 0;
      const maxAttempts = 180; // 3 minutes at 1 second intervals

      const pollForStatus = async () => {
        attempts++;
        try {
          const status = await electrobun.rpc?.request.pluginGetStateValue({
            pluginName: PLUGIN_NAME,
            key: 'shareLibraryStatus',
          }) as { status: string; output?: string; error?: string; timestamp?: number } | undefined;

          console.log('[WebflowSlate] Share status:', status);

          // Only process if the status is newer than when we started
          if (status && status.timestamp && status.timestamp > startTime) {
            if (status.status === 'running') {
              setCommandOutput("Sharing library to Webflow...\nThis may take a moment.");
            } else if (status.status === 'success') {
              // Clean up the output - remove expect noise (the 'y' responses and spawn line)
              let output = status.output || '';
              // Remove the spawn line
              output = output.replace(/^spawn bunx @webflow\/webflow-cli library share\n?/m, '');
              // Remove stray 'y' lines from expect auto-responses
              output = output.replace(/^y\n/gm, '');
              // Remove deprecation warnings
              output = output.replace(/\(node:\d+\).*DeprecationWarning.*\n?/g, '');
              output = output.replace(/\(Use `node --trace-deprecation.*\n?/g, '');
              // Clean up any double newlines
              output = output.replace(/\n{3,}/g, '\n\n');
              output = output.trim();

              setCommandOutput(`✓ Library shared successfully!\n\n${output}`);
              setShareRunning(false);
              return; // Stop polling
            } else if (status.status === 'error') {
              setError(status.error || 'Failed to share library');
              setCommandOutput(null);
              setShareRunning(false);
              return; // Stop polling
            }
          }

          // Continue polling if we haven't hit max attempts
          if (attempts < maxAttempts && shareRunning()) {
            setTimeout(pollForStatus, 1000);
          } else if (attempts >= maxAttempts) {
            setCommandOutput("Share command is still running in the background.\nCheck your system notifications for results.");
            setShareRunning(false);
          }
        } catch (e) {
          console.error('[WebflowSlate] Error polling for status:', e);
          if (attempts < maxAttempts && shareRunning()) {
            setTimeout(pollForStatus, 1000);
          }
        }
      };

      // Start polling after a short delay
      setTimeout(pollForStatus, 500);

    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      setShareRunning(false);
    }
  };

  // Code Components: Dev server state
  const [devServerTerminalId, setDevServerTerminalId] = createSignal<string | null>(null);
  const [devServerRunning, setDevServerRunning] = createSignal(false);

  // Start dev server (bundle + serve)
  const startDevServer = async () => {
    setBundleRunning(true);
    setCommandOutput(null);
    setError(null);
    try {
      const cwd = getProjectRoot();
      if (!cwd) {
        throw new Error("Could not determine project directory");
      }

      // Bundle library for local testing
      setCommandOutput("Bundling components...\n");
      await runCommandWithEnv("bunx", [
        "@webflow/webflow-cli", "library", "bundle",
        "--public-path", "http://localhost:4000/",
        "--dev"
      ], {
        WEBFLOW_TELEMETRY: 'false',
        DO_NOT_TRACK: '1',
      });

      // Create a terminal and start the server
      setCommandOutput((prev) => (prev || "") + "\nStarting dev server...\n");
      const terminalId = await electrobun.rpc?.request.createTerminal({ cwd });
      if (terminalId) {
        setDevServerTerminalId(terminalId);
        // Send the serve command to the terminal
        await electrobun.rpc?.request.writeToTerminal({
          terminalId,
          data: "bunx serve -l 4000 -s dist\n"
        });
        setDevServerRunning(true);
        setCommandOutput((prev) => (prev || "") + "\n✓ Dev server running at http://localhost:4000\n\nTo preview in Webflow Designer:\n1. Open your site in Webflow Designer\n2. Go to Apps panel → Code Components\n3. Click 'Load dev library' → http://localhost:4000\n");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
    } finally {
      setBundleRunning(false);
    }
  };

  // Stop dev server
  const stopDevServer = async () => {
    const terminalId = devServerTerminalId();
    if (terminalId) {
      // Send Ctrl+C to stop the server
      await electrobun.rpc?.request.writeToTerminal({
        terminalId,
        data: "\x03" // Ctrl+C
      });
      // Kill the terminal
      await electrobun.rpc?.request.killTerminal({ terminalId });
      setDevServerTerminalId(null);
      setDevServerRunning(false);
      setCommandOutput("Dev server stopped.\n");
    }
  };

  // Toggle dev server
  const toggleDevServer = async () => {
    if (devServerRunning()) {
      await stopDevServer();
    } else {
      await startDevServer();
    }
  };

  // Update Code Components config (webflow.json)
  const updateCodeComponentsConfig = async (key: string, value: string) => {
    const configPath = props.node?.path;
    if (!configPath) return;

    try {
      // Read current config
      const result = await electrobun.rpc?.request.readFile({ path: configPath });
      if (!result?.textContent) return;

      const currentConfig = JSON.parse(result.textContent);

      // Update the appropriate field
      // The webflow.json can have either a "library" object or flat structure
      if (currentConfig.library) {
        if (value) {
          currentConfig.library[key] = value;
        } else {
          // Remove empty values (CLI doesn't like empty strings for id)
          delete currentConfig.library[key];
        }
      } else {
        if (value) {
          currentConfig[key] = value;
        } else {
          delete currentConfig[key];
        }
      }

      // Write back
      await electrobun.rpc?.request.writeFile({
        path: configPath,
        value: JSON.stringify(currentConfig, null, 2),
      });

      // Update local config state
      setConfig(currentConfig);
    } catch (e) {
      console.error('[WebflowSlate] Failed to update config:', e);
      setError(`Failed to update config: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Open Webflow Dashboard
  const openWebflowDashboard = () => {
    openNewTabForNode('__COLAB_INTERNAL__/web', false, { focusNewTab: true, url: "https://webflow.com/dashboard" });
  };

  // Update Cloud config file with selected site
  const updateCloudConfigSite = async (site: WebflowSite, token: string) => {
    if (!props.node?.path) {
      console.error('[WebflowSlate] updateCloudConfigSite: no node path');
      return;
    }

    console.log('[WebflowSlate] updateCloudConfigSite:', site.displayName, 'path:', props.node.path);

    try {
      // Read current config
      const result = await electrobun.rpc?.request.readFile({ path: props.node.path });
      if (!result?.textContent) {
        setError('Failed to read config file');
        return;
      }

      const currentConfig = JSON.parse(result.textContent);

      // Update the cloud section with site info
      const newConfig = {
        ...currentConfig,
        cloud: {
          ...(currentConfig.cloud || {}),
          siteId: site.id,
          siteName: site.displayName,
        },
      };

      const jsonContent = JSON.stringify(newConfig, null, 2);
      console.log('[WebflowSlate] Writing cloud config to:', props.node.path);

      const writeResult = await electrobun.rpc?.request.writeFile({
        path: props.node.path,
        value: jsonContent,
      });

      if (writeResult?.success) {
        setConfig(newConfig as any);
        console.log('[WebflowSlate] Cloud config saved successfully');
      } else {
        console.error('[WebflowSlate] writeFile failed:', writeResult?.error);
        setError('Failed to save configuration: ' + (writeResult?.error || 'unknown error'));
      }
    } catch (e) {
      console.error("[WebflowSlate] Failed to update cloud config:", e);
      setError("Failed to update configuration");
    }
  };

  // Update Cloud config field (e.g., mountPath)
  const updateCloudConfigField = async (key: string, value: string) => {
    if (!props.node?.path) return;

    try {
      const result = await electrobun.rpc?.request.readFile({ path: props.node.path });
      if (!result?.textContent) return;

      const currentConfig = JSON.parse(result.textContent);

      // Update the cloud section
      const newConfig = {
        ...currentConfig,
        cloud: {
          ...(currentConfig.cloud || {}),
          [key]: value || undefined, // Remove empty values
        },
      };

      // Clean up undefined values
      if (!newConfig.cloud[key]) {
        delete newConfig.cloud[key];
      }

      await electrobun.rpc?.request.writeFile({
        path: props.node.path,
        value: JSON.stringify(newConfig, null, 2),
      });

      setConfig(newConfig as any);
    } catch (e) {
      console.error('[WebflowSlate] Failed to update cloud config field:', e);
      setError(`Failed to update ${key}`);
    }
  };

  // Store token for use in callbacks
  const [authToken, setAuthToken] = createSignal<string | null>(null);

  // Auto-detect slate type from config content for webflow.json files
  // This allows a single webflow.json pattern to render different UIs based on content
  const effectiveSlateType = () => {
    // If not code-components, use the passed slateType
    if (props.slateType !== "code-components") return props.slateType;

    const cfg = config() as any;
    if (!cfg) return props.slateType;

    // If webflow.json has "cloud" section but no "library" section, show cloud UI
    if (cfg.cloud && !cfg.library) {
      return "cloud" as const;
    }

    return props.slateType;
  };

  // Initialize component
  onMount(async () => {
    console.log('[WebflowSlate] onMount, slateType:', props.slateType);

    const token = await checkConnection();
    console.log('[WebflowSlate] token found:', !!token);
    if (token) {
      setAuthToken(token);
      await loadSitesFromState();
      console.log('[WebflowSlate] sites loaded:', sites().length);
    }
    await loadConfig();
    console.log('[WebflowSlate] config loaded:', config());

    if (token && props.slateType === "devlink") {
      // Check sync status for DevLink projects
      checkSyncStatus();
    }

    setLoading(false);
  });

  return (
    <div
      style={{
        background: "#1e1e1e",
        color: "#d9d9d9",
        height: "100%",
        overflow: "auto",
        padding: "20px",
        "font-family":
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <Show when={loading()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            height: "200px",
            color: "#888",
          }}
        >
          Loading Webflow configuration...
        </div>
      </Show>

      <Show when={!loading()}>
        <Switch>
          {/* DevLink Project Slate */}
          <Match when={effectiveSlateType() === "devlink"}>
            <DevLinkSlateContent
              config={config() as DevLinkConfig}
              connected={connected()}
              sites={sites()}
              cwd={getProjectRoot() || ""}
              siteId={(config() as DevLinkConfig)?.siteId || null}
              siteToken={(() => {
                const cfg = config() as DevLinkConfig | null;
                const siteId = cfg?.siteId;
                return siteId ? (getSiteToken(siteId) || authToken()) : null;
              })()}
              onOpenSettings={openSettings}
              onChangeSite={(site) => {
                const token = authToken();
                if (token) updateConfigSite(site, token);
              }}
              syncStatus={syncStatus()}
              lastChecked={lastChecked()}
              error={error()}
              nodePath={props.node?.path}
            />
          </Match>

          {/* Code Components Slate */}
          <Match when={effectiveSlateType() === "code-components"}>
            <CodeComponentsSlateContent
              config={config() as CodeComponentsConfig}
              connected={connected()}
              cwd={getProjectRoot() || ""}
              onOpenSettings={openSettings}
              onOpenDashboard={openWebflowDashboard}
              onConfigChange={updateCodeComponentsConfig}
              error={error()}
              nodePath={props.node?.path}
            />
          </Match>

          {/* Cloud Project Slate */}
          <Match when={effectiveSlateType() === "cloud"}>
            <CloudSlateContent
              config={config() as CloudProjectConfig}
              connected={connected()}
              sites={sites()}
              cwd={getProjectRoot() || ""}
              siteId={(() => {
                const cfg = config() as CloudProjectConfig | null;
                return cfg?.cloud?.siteId || cfg?.siteId || null;
              })()}
              siteToken={(() => {
                const cfg = config() as CloudProjectConfig | null;
                const siteId = cfg?.cloud?.siteId || cfg?.siteId;
                return siteId ? (getSiteToken(siteId) || authToken()) : null;
              })()}
              onOpenSettings={openSettings}
              onChangeSite={(site) => {
                const token = authToken();
                if (token) updateCloudConfigSite(site, token);
              }}
              onConfigChange={updateCloudConfigField}
              error={error()}
              nodePath={props.node?.path}
            />
          </Match>

          {/* Dashboard Slate */}
          <Match when={effectiveSlateType() === "dashboard"}>
            <DashboardSlateContent
              connected={connected()}
              sites={sites()}
              onOpenSettings={openSettings}
            />
          </Match>
        </Switch>
      </Show>
    </div>
  );
};

// DevLink Project Content
const DevLinkSlateContent = (props: {
  config: DevLinkConfig | null;
  connected: boolean;
  sites: WebflowSite[];
  cwd: string;
  siteId: string | null;
  siteToken: string | null;
  onOpenSettings: () => void;
  onChangeSite: (site: WebflowSite) => void;
  syncStatus: string;
  lastChecked: Date | null;
  error: string | null;
  nodePath?: string;
}): JSXElement => {
  const [showSitePicker, setShowSitePicker] = createSignal(false);
  const [terminalMode, setTerminalMode] = createSignal<'none' | 'sync'>('none');
  let terminalRef: ColabTerminalElement | null = null;

  // Get the working directory
  const getTerminalCwd = () => {
    if (props.cwd) return props.cwd;
    if (props.nodePath) {
      const parts = props.nodePath.split('/');
      parts.pop();
      return parts.join('/');
    }
    return '/';
  };

  // Build command with env vars for site credentials
  const getEnvPrefix = () => {
    if (!props.siteId || !props.siteToken) return '';
    return `export WEBFLOW_SITE_ID="${props.siteId}" WEBFLOW_SITE_API_TOKEN="${props.siteToken}" && clear && `;
  };

  // Start sync in terminal
  const startSync = () => {
    if (!props.siteId || !props.siteToken) {
      return;
    }
    if (terminalMode() === 'sync' && terminalRef) {
      terminalRef.run(`${getEnvPrefix()}bunx @webflow/webflow-cli devlink sync`);
    } else {
      setTerminalMode('sync');
    }
  };

  // Stop the current terminal
  const stopTerminal = () => {
    if (terminalRef) {
      terminalRef.kill();
    }
    setTerminalMode('none');
    terminalRef = null;
  };

  // Called when terminal element is created
  const onTerminalRef = (el: ColabTerminalElement) => {
    terminalRef = el;
    setTimeout(() => {
      if (terminalMode() === 'sync') {
        el.run(`${getEnvPrefix()}bunx @webflow/webflow-cli devlink sync`);
      }
    }, 150);
  };

  // Format time as "today at 1:09pm" or just "1:09pm"
  const formatLastChecked = () => {
    if (!props.lastChecked) return null;
    const hours = props.lastChecked.getHours();
    const minutes = props.lastChecked.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    const minuteStr = minutes.toString().padStart(2, '0');
    return `${hour12}:${minuteStr}${ampm}`;
  };

  const badge = () => {
    switch (props.syncStatus) {
      case "synced":
        return { text: "Synced", color: "#00c853", bg: "#1b4332" };
      case "needs-sync":
        return { text: "Updates Available", color: "#fbbf24", bg: "#4a4026" };
      case "error":
        return { text: "Error", color: "#f87171", bg: "#5c2626" };
      default:
        return { text: "Unknown", color: "#888", bg: "#333" };
    }
  };

  // Get current site info from sites list
  const currentSite = () => props.sites.find(s => s.id === props.config?.siteId);

  // Check if we need to show the site selection UI (no site selected yet)
  const needsSiteSelection = () => props.connected && props.config && !props.config.siteId;

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "margin-bottom": "24px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            background: "#4353ff",
            "border-radius": "12px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "24px",
          }}
        >
          🔗
        </div>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              margin: 0,
              "font-size": "24px",
              "font-weight": 600,
              color: "#fff",
            }}
          >
            Webflow DevLink
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              "font-size": "14px",
              color: "#888",
            }}
          >
            Sync visual components from Webflow Designer
          </p>
        </div>
        <Show when={props.connected && props.syncStatus !== "unknown"}>
          <div
            style={{
              padding: "6px 12px",
              "border-radius": "6px",
              background: badge().bg,
              color: badge().color,
              "font-size": "12px",
              "font-weight": 500,
            }}
          >
            {badge().text}
          </div>
        </Show>
      </div>

      <Show when={!props.connected}>
        <ConnectPrompt onOpenSettings={props.onOpenSettings} />
      </Show>

      {/* Site Selection UI - shown when connected but no site selected */}
      <Show when={needsSiteSelection()}>
        <div
          style={{
            background: "#2a2a2a",
            border: "1px solid #4353ff",
            "border-radius": "8px",
            padding: "24px",
            "margin-bottom": "16px",
          }}
        >
          <div style={{ "text-align": "center", "margin-bottom": "16px" }}>
            <div style={{ "font-size": "32px", "margin-bottom": "8px" }}>🌐</div>
            <h3 style={{ margin: "0 0 8px 0", color: "#fff", "font-size": "18px", "font-weight": 500 }}>
              Select a Webflow Site
            </h3>
            <p style={{ margin: 0, color: "#888", "font-size": "13px" }}>
              Choose which site to sync components from
            </p>
          </div>

          <Show when={props.sites.length === 0}>
            <div style={{ "text-align": "center", color: "#888", padding: "20px" }}>
              <p style={{ margin: "0 0 12px 0" }}>Loading your sites...</p>
              <p style={{ margin: 0, "font-size": "12px" }}>
                If this takes too long, try refreshing or check your connection in Settings.
              </p>
            </div>
          </Show>

          <Show when={props.sites.length > 0}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
              <For each={props.sites}>
                {(site) => (
                  <button
                    onClick={() => props.onChangeSite(site)}
                    style={{
                      background: "#1e1e1e",
                      border: "1px solid #333",
                      "border-radius": "8px",
                      padding: "16px",
                      "text-align": "left",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#333";
                      e.currentTarget.style.borderColor = "#4353ff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#1e1e1e";
                      e.currentTarget.style.borderColor = "#333";
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          background: "#4353ff",
                          "border-radius": "8px",
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "center",
                          "font-size": "18px",
                        }}
                      >
                        🌐
                      </div>
                      <div>
                        <div style={{ "font-size": "14px", "font-weight": 500, color: "#fff" }}>
                          {site.displayName}
                        </div>
                        <Show when={site.shortName && site.shortName !== site.displayName}>
                          <div style={{ "font-size": "12px", color: "#666", "font-family": "monospace" }}>
                            {site.shortName}
                          </div>
                        </Show>
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.connected && props.config && props.config.siteId}>
        {/* Site Selector - shown when site is already selected */}
        <div
          style={{
            background: "#2a2a2a",
            "border-radius": "8px",
            padding: "16px 20px",
            "margin-bottom": "16px",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <div>
              <label style={{ "font-size": "12px", color: "#888", display: "block", "margin-bottom": "4px" }}>
                Connected Site
              </label>
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ "font-size": "16px", "font-weight": 500, color: "#fff" }}>
                  {currentSite()?.displayName || props.config?.siteName || "Unknown Site"}
                </span>
                <Show when={currentSite()?.shortName && currentSite()?.shortName !== currentSite()?.displayName}>
                  <span style={{ "font-size": "12px", color: "#666", "font-family": "monospace" }}>
                    {currentSite()?.shortName}
                  </span>
                </Show>
              </div>
            </div>
            <Show when={props.sites.length > 1}>
              <button
                onClick={() => setShowSitePicker(!showSitePicker())}
                style={{
                  background: "#333",
                  border: "1px solid #444",
                  "border-radius": "6px",
                  padding: "8px 12px",
                  color: "#d9d9d9",
                  "font-size": "12px",
                  cursor: "pointer",
                }}
              >
                {showSitePicker() ? "Cancel" : "Change Site"}
              </button>
            </Show>
          </div>

          {/* Site Picker Dropdown */}
          <Show when={showSitePicker()}>
            <div
              style={{
                "margin-top": "12px",
                "padding-top": "12px",
                "border-top": "1px solid #333",
              }}
            >
              <label style={{ "font-size": "12px", color: "#888", display: "block", "margin-bottom": "8px" }}>
                Select a different site:
              </label>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <For each={props.sites.filter(s => s.id !== props.config?.siteId)}>
                  {(site) => (
                    <button
                      onClick={() => {
                        props.onChangeSite(site);
                        setShowSitePicker(false);
                      }}
                      style={{
                        background: "#1e1e1e",
                        border: "1px solid #333",
                        "border-radius": "6px",
                        padding: "12px",
                        "text-align": "left",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#333"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "#1e1e1e"}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <span style={{ "font-size": "14px", "font-weight": 500, color: "#fff" }}>
                          {site.displayName}
                        </span>
                        <Show when={site.shortName && site.shortName !== site.displayName}>
                          <span style={{ "font-size": "12px", color: "#666", "font-family": "monospace" }}>
                            {site.shortName}
                          </span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Config Details */}
        <div
          style={{
            background: "#2a2a2a",
            "border-radius": "8px",
            padding: "20px",
            "margin-bottom": "16px",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              "font-size": "14px",
              color: "#fff",
              "font-weight": 500,
            }}
          >
            Configuration
          </h3>

          <ConfigField label="Components Path" value={props.config?.componentsPath} mono />
          <ConfigField label="Site ID" value={props.config?.siteId} mono />
        </div>

        <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "margin-bottom": "16px" }}>
          <ActionButton
            icon="↻"
            label="Sync Components"
            description="Sync latest from Webflow"
            onClick={startSync}
            active={terminalMode() === 'sync'}
          />
          <ActionButton
            icon="⚙"
            label="Settings"
            description="Configure connection"
            onClick={props.onOpenSettings}
          />
          <Show when={props.nodePath}>
            <ActionButton
              icon="✎"
              label="Edit Config"
              description="Open in code editor"
              onClick={() => props.nodePath && openNewTab({
                type: "file",
                path: props.nodePath,
                forceEditor: true,
              }, false)}
            />
          </Show>
        </div>

        {/* Error display */}
        <Show when={props.error}>
          <div
            style={{
              background: "#2a1515",
              border: "1px solid #5c2626",
              "border-radius": "8px",
              padding: "12px 16px",
              "margin-bottom": "16px",
              color: "#f87171",
              "font-size": "13px",
            }}
          >
            {props.error}
          </div>
        </Show>

        {/* PTY Terminal */}
        <Show when={terminalMode() !== 'none'}>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #333",
              "border-radius": "8px",
              overflow: "hidden",
              "margin-top": "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 12px",
                "border-bottom": "1px solid #333",
                background: "#1a1a1a",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ color: "#4353ff" }}>↻</span>
                <span style={{ "font-size": "12px", "font-weight": 500, color: "#fff" }}>
                  Syncing Components
                </span>
              </div>
              <button
                onClick={stopTerminal}
                style={{
                  background: "#333",
                  border: "1px solid #444",
                  "border-radius": "4px",
                  padding: "4px 8px",
                  color: "#888",
                  cursor: "pointer",
                  "font-size": "11px",
                }}
              >
                Close
              </button>
            </div>
            <div style={{ height: "300px" }}>
              <colab-terminal
                prop:cwd={getTerminalCwd()}
                ref={onTerminalRef}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

// Code Components Content
const CodeComponentsSlateContent = (props: {
  config: CodeComponentsConfig | null;
  connected: boolean;
  cwd: string;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onConfigChange: (key: string, value: string) => Promise<void>;
  error: string | null;
  nodePath?: string;
}): JSXElement => {
  const [terminalMode, setTerminalMode] = createSignal<'none' | 'share' | 'dev'>('none');
  let terminalRef: ColabTerminalElement | null = null;

  // Get the working directory
  const getTerminalCwd = () => {
    if (props.cwd) return props.cwd;
    if (props.nodePath) {
      const parts = props.nodePath.split('/');
      parts.pop();
      return parts.join('/');
    }
    return '/';
  };

  // Start share library in terminal
  const startShare = () => {
    if (terminalMode() === 'share' && terminalRef) {
      terminalRef.run('bunx @webflow/webflow-cli library share');
    } else {
      setTerminalMode('share');
    }
  };

  // Start dev server in terminal
  const startDevServer = () => {
    if (terminalMode() === 'dev' && terminalRef) {
      terminalRef.run('bunx @webflow/webflow-cli library bundle --public-path "http://localhost:4000/" --dev && bunx serve dist -l 4000 --cors');
    } else {
      setTerminalMode('dev');
    }
  };

  // Stop the current terminal
  const stopTerminal = () => {
    if (terminalRef) {
      terminalRef.kill();
    }
    setTerminalMode('none');
    terminalRef = null;
  };

  // Called when terminal element is created
  const onTerminalRef = (el: ColabTerminalElement) => {
    terminalRef = el;
    setTimeout(() => {
      if (terminalMode() === 'share') {
        el.run('bunx @webflow/webflow-cli library share');
      } else if (terminalMode() === 'dev') {
        el.run('bunx @webflow/webflow-cli library bundle --public-path "http://localhost:4000/" --dev && bunx serve dist -l 4000 --cors');
      }
    }, 150);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "margin-bottom": "24px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            background: "#9333ea",
            "border-radius": "12px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "24px",
          }}
        >
          📦
        </div>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              margin: 0,
              "font-size": "24px",
              "font-weight": 600,
              color: "#fff",
            }}
          >
            {props.config?.library?.name || props.config?.name || "Code Components"}
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              "font-size": "14px",
              color: "#888",
            }}
          >
            Share React components to Webflow Designer
          </p>
        </div>
        <Show when={props.config?.version}>
          <div
            style={{
              padding: "6px 12px",
              "border-radius": "6px",
              background: "#4353ff",
              color: "#fff",
              "font-size": "12px",
              "font-weight": 500,
            }}
          >
            v{props.config?.version}
          </div>
        </Show>
      </div>

      <Show when={props.config}>
        <div
          style={{
            background: "#2a2a2a",
            "border-radius": "8px",
            padding: "20px",
            "margin-bottom": "16px",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              "font-size": "14px",
              color: "#fff",
              "font-weight": 500,
            }}
          >
            Library Info
          </h3>

          <EditableConfigField
            label="Name"
            value={props.config?.library?.name || props.config?.name}
            placeholder="Enter library name..."
            onChange={(value) => props.onConfigChange("name", value)}
          />
          <EditableConfigField
            label="Description"
            value={props.config?.library?.description || (props.config as any)?.description}
            placeholder="Enter library description..."
            multiline
            onChange={(value) => props.onConfigChange("description", value)}
          />
          <EditableConfigField
            label="Library ID"
            value={props.config?.library?.id || (props.config as any)?.id}
            placeholder="e.g. my-library-1"
            mono
            validate={(value) => {
              // Convert to slug: lowercase, replace spaces with hyphens, remove invalid chars
              let slug = value
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
              // If empty after validation, don't save (return original to prevent empty)
              return slug || value;
            }}
            onChange={(value) => {
              // Don't save empty IDs - CLI requires at least 1 character
              if (value && value.trim()) {
                props.onConfigChange("id", value);
              }
            }}
          />
          <Show when={props.config?.version}>
            <ConfigField label="Version" value={props.config?.version} />
          </Show>
          <div style={{ "margin-top": "12px" }}>
            <label style={{ "font-size": "12px", color: "#888", display: "block", "margin-bottom": "8px" }}>
              Components ({(props.config?.library?.components || props.config?.components)?.length || 0})
            </label>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              <For each={props.config?.library?.components || props.config?.components || []}>
                {(component) => (
                  <span
                    style={{
                      background: "#333",
                      padding: "4px 10px",
                      "border-radius": "4px",
                      "font-size": "12px",
                      color: "#d9d9d9",
                    }}
                  >
                    {component}
                  </span>
                )}
              </For>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "margin-bottom": "16px" }}>
          <ActionButton
            icon="↑"
            label="Share Library"
            description="Publish to Webflow"
            onClick={startShare}
            active={terminalMode() === 'share'}
            primary
          />
          <ActionButton
            icon={terminalMode() === 'dev' ? "⏹" : "▶"}
            label={terminalMode() === 'dev' ? "Stop Server" : "Dev Server"}
            description={terminalMode() === 'dev' ? "Running on :4000" : "Bundle & serve"}
            onClick={() => terminalMode() === 'dev' ? stopTerminal() : startDevServer()}
            active={terminalMode() === 'dev'}
          />
          <ActionButton
            icon="🌐"
            label="Open Dashboard"
            description="Open Webflow"
            onClick={props.onOpenDashboard}
          />
          <ActionButton
            icon="⚙"
            label="Settings"
            description="Configure connection"
            onClick={props.onOpenSettings}
          />
        </div>

        {/* Error display */}
        <Show when={props.error}>
          <div
            style={{
              background: "#2a1515",
              border: "1px solid #5c2626",
              "border-radius": "8px",
              padding: "12px 16px",
              "margin-bottom": "16px",
              color: "#f87171",
              "font-size": "13px",
            }}
          >
            {props.error}
          </div>
        </Show>

        {/* PTY Terminal */}
        <Show when={terminalMode() !== 'none'}>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #333",
              "border-radius": "8px",
              overflow: "hidden",
              "margin-top": "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 12px",
                "border-bottom": "1px solid #333",
                background: "#1a1a1a",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ color: terminalMode() === 'share' ? "#a855f7" : "#60a5fa" }}>
                  {terminalMode() === 'share' ? "↑" : "▶"}
                </span>
                <span style={{ "font-size": "12px", "font-weight": 500, color: "#fff" }}>
                  {terminalMode() === 'share' ? "Sharing Library" : "Development Server"}
                </span>
              </div>
              <button
                onClick={stopTerminal}
                style={{
                  background: "#333",
                  border: "1px solid #444",
                  "border-radius": "4px",
                  padding: "4px 8px",
                  color: "#888",
                  cursor: "pointer",
                  "font-size": "11px",
                }}
              >
                Close
              </button>
            </div>
            <div style={{ height: "300px" }}>
              <colab-terminal
                prop:cwd={getTerminalCwd()}
                ref={onTerminalRef}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

// Cloud Project Content
const CloudSlateContent = (props: {
  config: CloudProjectConfig | null;
  connected: boolean;
  sites: WebflowSite[];
  cwd: string;
  siteId: string | null;
  siteToken: string | null;
  onOpenSettings: () => void;
  onChangeSite: (site: WebflowSite) => void;
  onConfigChange: (key: string, value: string) => Promise<void>;
  error: string | null;
  nodePath?: string;
}): JSXElement => {
  const [showSitePicker, setShowSitePicker] = createSignal(false);
  const [terminalMode, setTerminalMode] = createSignal<'none' | 'deploy' | 'dev'>('none');
  let terminalRef: ColabTerminalElement | null = null;

  // Get the working directory - derive from nodePath if cwd not provided
  const getTerminalCwd = () => {
    if (props.cwd) return props.cwd;
    if (props.nodePath) {
      // nodePath is the config file path, get its directory
      const parts = props.nodePath.split('/');
      parts.pop(); // Remove filename
      return parts.join('/');
    }
    return '/';
  };

  const getFrameworkIcon = () => {
    switch (props.config?.framework) {
      case "astro":
        return "🚀";
      case "nextjs":
        return "▲";
      default:
        return "☁";
    }
  };

  const getFrameworkColor = () => {
    switch (props.config?.framework) {
      case "astro":
        return "#ff5d01";
      case "nextjs":
        return "#000";
      default:
        return "#4353ff";
    }
  };

  // Get mountPath from either nested cloud config or top-level
  const getMountPath = () => props.config?.cloud?.mountPath || props.config?.mountPath;

  // Start deploy in terminal
  const startDeploy = () => {
    if (!props.siteId || !props.siteToken) {
      return;
    }
    // If already in deploy mode, just run the command again
    if (terminalMode() === 'deploy' && terminalRef) {
      // Set env vars, clear to hide tokens, then run deploy
      terminalRef.run(`export WEBFLOW_SITE_ID="${props.siteId}" WEBFLOW_SITE_API_TOKEN="${props.siteToken}" WEBFLOW_SKIP_UPDATE_CHECKS=true && clear && bunx @webflow/webflow-cli cloud deploy`);
    } else {
      setTerminalMode('deploy');
    }
  };

  // Start dev server in terminal
  const startDevServer = () => {
    if (terminalMode() === 'dev' && terminalRef) {
      // Already running, run command again
      terminalRef.run('bun install && bun run dev');
    } else {
      setTerminalMode('dev');
    }
  };

  // Stop the current terminal
  const stopTerminal = () => {
    if (terminalRef) {
      terminalRef.kill();
    }
    setTerminalMode('none');
    terminalRef = null;
  };

  // Called when terminal element is created
  const onTerminalRef = (el: ColabTerminalElement) => {
    terminalRef = el;
    // Run the appropriate command once terminal is ready
    // Small delay to ensure terminal is initialized
    setTimeout(() => {
      if (terminalMode() === 'deploy' && props.siteId && props.siteToken) {
        // Set env vars, clear screen to hide tokens, then run deploy
        el.run(`export WEBFLOW_SITE_ID="${props.siteId}" WEBFLOW_SITE_API_TOKEN="${props.siteToken}" WEBFLOW_SKIP_UPDATE_CHECKS=true && clear && bunx @webflow/webflow-cli cloud deploy`);
      } else if (terminalMode() === 'dev') {
        el.run('bun install && bun run dev');
      }
    }, 150);
  };

  // Get siteId from either nested cloud config or top-level
  const getSiteId = () => props.config?.cloud?.siteId || props.config?.siteId;
  const getSiteName = () => props.config?.cloud?.siteName || props.config?.siteName;
  const selectedSite = () => props.sites.find(s => s.id === getSiteId());

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "margin-bottom": "24px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            background: getFrameworkColor(),
            "border-radius": "12px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "24px",
          }}
        >
          {getFrameworkIcon()}
        </div>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              margin: 0,
              "font-size": "24px",
              "font-weight": 600,
              color: "#fff",
            }}
          >
            {props.config?.name || "Webflow Cloud"}
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              "font-size": "14px",
              color: "#888",
            }}
          >
            Deploy {props.config?.framework || "apps"} to Webflow's edge infrastructure
          </p>
        </div>
        <Show when={props.config?.framework}>
          <div
            style={{
              padding: "6px 12px",
              "border-radius": "6px",
              background: "#2a2a2a",
              color: "#d9d9d9",
              "font-size": "12px",
              "font-weight": 500,
              "text-transform": "capitalize",
            }}
          >
            {props.config?.framework}
          </div>
        </Show>
      </div>

      <Show when={!props.connected}>
        <ConnectPrompt onOpenSettings={props.onOpenSettings} />
      </Show>

      <Show when={props.connected && props.config}>
        {/* Site Selection */}
        <Show when={!getSiteId()}>
          <div
            style={{
              background: "#2a2a2a",
              "border-radius": "8px",
              padding: "20px",
              "margin-bottom": "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 16px 0",
                "font-size": "14px",
                color: "#fff",
                "font-weight": 500,
              }}
            >
              Select a Webflow Site
            </h3>
            <p style={{ "font-size": "13px", color: "#888", "margin-bottom": "16px" }}>
              Choose which site to deploy this app to:
            </p>
            <Show when={props.sites.length > 0}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <For each={props.sites}>
                  {(site) => (
                    <button
                      onClick={() => props.onChangeSite(site)}
                      style={{
                        background: "#1e1e1e",
                        border: "1px solid #333",
                        "border-radius": "8px",
                        padding: "16px",
                        cursor: "pointer",
                        "text-align": "left",
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ "font-size": "14px", "font-weight": 500, color: "#fff" }}>
                        {site.displayName}
                      </div>
                      <div style={{ "font-size": "12px", color: "#666", "margin-top": "4px" }}>
                        {site.shortName}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.sites.length === 0}>
              <p style={{ color: "#666", "font-size": "13px" }}>
                No sites found. Make sure your Webflow account has sites available.
              </p>
            </Show>
          </div>
        </Show>

        {/* Site Info (when selected) */}
        <Show when={getSiteId()}>
          <div
            style={{
              background: "#2a2a2a",
              "border-radius": "8px",
              padding: "20px",
              "margin-bottom": "16px",
            }}
          >
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}>
              <h3
                style={{
                  margin: 0,
                  "font-size": "14px",
                  color: "#fff",
                  "font-weight": 500,
                }}
              >
                Deployment Target
              </h3>
              <button
                onClick={() => setShowSitePicker(!showSitePicker())}
                style={{
                  background: "transparent",
                  border: "1px solid #444",
                  "border-radius": "4px",
                  padding: "4px 8px",
                  color: "#888",
                  cursor: "pointer",
                  "font-size": "12px",
                }}
              >
                Change
              </button>
            </div>

            <Show when={!showSitePicker()}>
              <div
                style={{
                  background: "#1e1e1e",
                  "border-radius": "8px",
                  padding: "16px",
                  border: "1px solid #333",
                }}
              >
                <div style={{ "font-size": "16px", "font-weight": 500, color: "#fff" }}>
                  {selectedSite()?.displayName || getSiteName() || "Unknown Site"}
                </div>
                <div style={{ "font-size": "12px", color: "#666", "margin-top": "4px" }}>
                  {selectedSite()?.shortName || getSiteId()}
                </div>
              </div>
            </Show>

            <Show when={showSitePicker()}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <For each={props.sites}>
                  {(site) => (
                    <button
                      onClick={() => {
                        props.onChangeSite(site);
                        setShowSitePicker(false);
                      }}
                      style={{
                        background: site.id === getSiteId() ? "#3a3a3a" : "#1e1e1e",
                        border: site.id === getSiteId() ? "1px solid #4353ff" : "1px solid #333",
                        "border-radius": "8px",
                        padding: "16px",
                        cursor: "pointer",
                        "text-align": "left",
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ "font-size": "14px", "font-weight": 500, color: "#fff" }}>
                        {site.displayName}
                      </div>
                      <div style={{ "font-size": "12px", color: "#666", "margin-top": "4px" }}>
                        {site.shortName}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Configuration Section */}
          <div
            style={{
              background: "#2a2a2a",
              "border-radius": "8px",
              padding: "20px",
              "margin-bottom": "16px",
            }}
          >
            <h3
              style={{
                margin: "0 0 16px 0",
                "font-size": "14px",
                color: "#fff",
                "font-weight": 500,
              }}
            >
              Configuration
            </h3>
            <ConfigField label="Framework" value={props.config?.framework} />
            <EditableConfigField
              label="Mount Path"
              value={getMountPath()}
              placeholder="/app (optional - where to mount on your site)"
              mono
              onChange={(value) => props.onConfigChange("mountPath", value)}
            />
          </div>
        </Show>

        <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "margin-bottom": "16px" }}>
          <ActionButton
            icon="🚀"
            label="Deploy"
            description={getSiteId() ? "Push to Webflow Cloud" : "Select a site first"}
            onClick={startDeploy}
            active={terminalMode() === 'deploy'}
          />
          <ActionButton
            icon={terminalMode() === 'dev' ? "⏹" : "▶"}
            label={terminalMode() === 'dev' ? "Stop Server" : "Dev Server"}
            description={terminalMode() === 'dev' ? "Running on :4321" : "Run locally"}
            onClick={() => terminalMode() === 'dev' ? stopTerminal() : startDevServer()}
            active={terminalMode() === 'dev'}
          />
          <ActionButton
            icon="⚙"
            label="Settings"
            description="Configure connection"
            onClick={props.onOpenSettings}
          />
        </div>

        {/* Error display */}
        <Show when={props.error}>
          <div
            style={{
              background: "#2a1515",
              border: "1px solid #5c2626",
              "border-radius": "8px",
              padding: "12px 16px",
              "margin-bottom": "16px",
              color: "#f87171",
              "font-size": "13px",
            }}
          >
            {props.error}
          </div>
        </Show>

        {/* PTY Terminal - shows when deploy or dev mode is active */}
        <Show when={terminalMode() !== 'none'}>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #333",
              "border-radius": "8px",
              overflow: "hidden",
              "margin-top": "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 12px",
                "border-bottom": "1px solid #333",
                background: "#1a1a1a",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ color: terminalMode() === 'deploy' ? "#4ade80" : "#60a5fa" }}>
                  {terminalMode() === 'deploy' ? "🚀" : "▶"}
                </span>
                <span style={{ "font-size": "12px", "font-weight": 500, color: "#fff" }}>
                  {terminalMode() === 'deploy' ? "Deploying to Webflow Cloud" : "Development Server"}
                </span>
              </div>
              <button
                onClick={stopTerminal}
                style={{
                  background: "#333",
                  border: "1px solid #444",
                  "border-radius": "4px",
                  padding: "4px 8px",
                  color: "#888",
                  cursor: "pointer",
                  "font-size": "11px",
                }}
              >
                Close
              </button>
            </div>
            <div style={{ height: "300px" }}>
              <colab-terminal
                prop:cwd={getTerminalCwd()}
                ref={onTerminalRef}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

// Dashboard Content
const DashboardSlateContent = (props: {
  connected: boolean;
  sites: WebflowSite[];
  onOpenSettings: () => void;
}): JSXElement => {
  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          "margin-bottom": "24px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            background: "#4353ff",
            "border-radius": "12px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "24px",
          }}
        >
          🌐
        </div>
        <div>
          <h1
            style={{
              margin: 0,
              "font-size": "24px",
              "font-weight": 600,
              color: "#fff",
            }}
          >
            Webflow Dashboard
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              "font-size": "14px",
              color: "#888",
            }}
          >
            Manage your Webflow sites and projects
          </p>
        </div>
      </div>

      <Show when={!props.connected}>
        <ConnectPrompt onOpenSettings={props.onOpenSettings} large />
      </Show>

      <Show when={props.connected}>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
          }}
        >
          <For each={props.sites}>
            {(site) => (
              <SiteCard site={site} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// Reusable Components

const ConnectPrompt = (props: { onOpenSettings: () => void; large?: boolean }): JSXElement => (
  <div
    style={{
      background: "#2a2a2a",
      border: "1px solid #444",
      "border-radius": "8px",
      padding: props.large ? "40px 20px" : "20px",
      "text-align": "center",
    }}
  >
    <Show when={props.large}>
      <div style={{ "font-size": "48px", "margin-bottom": "16px" }}>🔐</div>
    </Show>
    <h2
      style={{
        margin: "0 0 8px 0",
        "font-size": props.large ? "18px" : "14px",
        color: "#fff",
      }}
    >
      Connect Your Webflow Account
    </h2>
    <p
      style={{
        margin: "0 0 16px 0",
        color: "#888",
        "font-size": "13px",
        "max-width": "400px",
        "margin-left": "auto",
        "margin-right": "auto",
      }}
    >
      Add your Webflow API token to access your sites and sync components.
    </p>
    <button
      onClick={props.onOpenSettings}
      style={{
        background: "#4353ff",
        color: "#fff",
        border: "none",
        "border-radius": "6px",
        padding: "10px 20px",
        "font-size": "14px",
        "font-weight": 500,
        cursor: "pointer",
      }}
    >
      Add API Token
    </button>
  </div>
);

const ConfigField = (props: { label: string; value?: string; mono?: boolean }): JSXElement => (
  <Show when={props.value}>
    <div style={{ "margin-bottom": "12px" }}>
      <label style={{ "font-size": "12px", color: "#888", display: "block", "margin-bottom": "4px" }}>
        {props.label}
      </label>
      <div
        style={{
          background: "#1e1e1e",
          padding: "8px 12px",
          "border-radius": "4px",
          "font-family": props.mono ? "monospace" : "inherit",
          "font-size": "13px",
          color: "#d9d9d9",
        }}
      >
        {props.value}
      </div>
    </div>
  </Show>
);

// Editable config field with inline editing
const EditableConfigField = (props: {
  label: string;
  value?: string;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  validate?: (value: string) => string; // Transform/validate input before saving
  onChange: (value: string) => void;
}): JSXElement => {
  const [editing, setEditing] = createSignal(false);
  const [localValue, setLocalValue] = createSignal(props.value || "");

  // Update local value when props change
  createEffect(() => {
    setLocalValue(props.value || "");
  });

  const handleSave = () => {
    let value = localValue();
    if (props.validate) {
      value = props.validate(value);
      setLocalValue(value); // Update local value with validated version
    }
    props.onChange(value);
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !props.multiline) {
      handleSave();
    } else if (e.key === "Escape") {
      setLocalValue(props.value || "");
      setEditing(false);
    }
  };

  return (
    <div style={{ "margin-bottom": "12px" }}>
      <label style={{ "font-size": "12px", color: "#888", display: "block", "margin-bottom": "4px" }}>
        {props.label}
      </label>
      <Show
        when={editing()}
        fallback={
          <div
            onClick={() => setEditing(true)}
            style={{
              background: "#1e1e1e",
              padding: "8px 12px",
              "border-radius": "4px",
              "font-family": props.mono ? "monospace" : "inherit",
              "font-size": "13px",
              color: props.value ? "#d9d9d9" : "#666",
              cursor: "pointer",
              border: "1px solid transparent",
              transition: "border-color 0.2s",
              "min-height": props.multiline ? "60px" : "auto",
              "white-space": props.multiline ? "pre-wrap" : "nowrap",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4353ff")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
          >
            {props.value || props.placeholder || "Click to edit..."}
          </div>
        }
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
          <Show
            when={props.multiline}
            fallback={
              <input
                type="text"
                value={localValue()}
                onInput={(e) => setLocalValue(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                autofocus
                style={{
                  flex: 1,
                  background: "#1e1e1e",
                  border: "1px solid #4353ff",
                  "border-radius": "4px",
                  padding: "8px 12px",
                  "font-family": props.mono ? "monospace" : "inherit",
                  "font-size": "13px",
                  color: "#d9d9d9",
                  outline: "none",
                }}
              />
            }
          >
            <textarea
              value={localValue()}
              onInput={(e) => setLocalValue(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              autofocus
              style={{
                flex: 1,
                background: "#1e1e1e",
                border: "1px solid #4353ff",
                "border-radius": "4px",
                padding: "8px 12px",
                "font-family": props.mono ? "monospace" : "inherit",
                "font-size": "13px",
                color: "#d9d9d9",
                outline: "none",
                resize: "vertical",
                "min-height": "60px",
              }}
            />
          </Show>
          <button
            onClick={handleSave}
            style={{
              background: "#4353ff",
              border: "none",
              "border-radius": "4px",
              padding: "8px 12px",
              color: "#fff",
              cursor: "pointer",
              "font-size": "12px",
            }}
          >
            Save
          </button>
        </div>
      </Show>
    </div>
  );
};

const ActionButton = (props: {
  icon: string;
  label: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
  primary?: boolean;
  active?: boolean;
}): JSXElement => {
  const getBackground = () => {
    if (props.primary) return "#4353ff";
    if (props.active) return "#1a3a1a";
    return "#2a2a2a";
  };

  const getBorder = () => {
    if (props.primary) return "none";
    if (props.active) return "1px solid #2d5a2d";
    return "1px solid #444";
  };

  return (
    <button
      onClick={props.onClick}
      disabled={props.loading}
      style={{
        background: getBackground(),
        border: getBorder(),
        "border-radius": "8px",
        padding: "16px 20px",
        cursor: props.loading ? "wait" : "pointer",
        "text-align": "left",
        "min-width": "160px",
        opacity: props.loading ? 0.7 : 1,
        transition: "all 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "4px",
        }}
      >
        <span style={{ "font-size": "16px" }}>
          {props.loading ? "⏳" : props.icon}
        </span>
        <span
          style={{ "font-size": "14px", "font-weight": 500, color: props.active ? "#4ade80" : "#fff" }}
        >
          {props.label}
        </span>
      </div>
      <div style={{ "font-size": "12px", color: props.primary ? "rgba(255,255,255,0.7)" : props.active ? "#6ee7a0" : "#888" }}>
        {props.loading ? "Running..." : props.description}
      </div>
    </button>
  );
};

const TerminalOutputPanel = (props: {
  output: string | null;
  error: string | null;
  streamTerminalId?: string | null;
}): JSXElement => {
  let containerRef: HTMLDivElement | undefined;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let initialized = false;
  let lastWrittenOutput = "";

  const initTerminal = () => {
    if (!containerRef || initialized) return;
    initialized = true;

    terminal = new Terminal({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'Monaco, "Courier New", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#d9d9d9",
        cursor: "transparent",
      },
      scrollback: 1000,
      convertEol: true,
      disableStdin: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef);

    // Fit after DOM is ready
    requestAnimationFrame(() => {
      fitAddon?.fit();
      // Write content after fit
      const content = props.error || props.output;
      if (content && terminal) {
        terminal.write(content);
        lastWrittenOutput = content;
      }
    });
  };

  // Handle streaming terminal output
  const handleTerminalOutput = (event: CustomEvent<{ terminalId: string; data: string }>) => {
    const data = event.detail;
    if (props.streamTerminalId && data.terminalId === props.streamTerminalId && terminal) {
      terminal.write(data.data);
      fitAddon?.fit();
    }
  };

  onMount(() => {
    if (containerRef && (props.output || props.error || props.streamTerminalId)) {
      initTerminal();
    }
    // Subscribe to terminal output for streaming
    window.addEventListener('terminalOutput', handleTerminalOutput as EventListener);
  });

  // Update content when props change (for non-streaming output)
  createEffect(() => {
    const content = props.error || props.output;
    if (content) {
      if (!initialized && containerRef) {
        initTerminal();
      } else if (terminal && content !== lastWrittenOutput) {
        // Only clear and rewrite if content changed (for non-streaming)
        if (!props.streamTerminalId) {
          terminal.clear();
          terminal.write(content);
          lastWrittenOutput = content;
          fitAddon?.fit();
        }
      }
    }
  });

  // Initialize terminal when streamTerminalId is set
  createEffect(() => {
    if (props.streamTerminalId && !initialized && containerRef) {
      initTerminal();
    }
  });

  onCleanup(() => {
    window.removeEventListener('terminalOutput', handleTerminalOutput as EventListener);
    terminal?.dispose();
    terminal = null;
    fitAddon = null;
    initialized = false;
    lastWrittenOutput = "";
  });

  const hasContent = () => props.output || props.error || props.streamTerminalId;

  return (
    <div
      style={{
        display: hasContent() ? "block" : "none",
        background: props.error ? "#1a0a0a" : "#0a0a0a",
        border: `1px solid ${props.error ? "#5c2626" : "#333"}`,
        "border-radius": "8px",
        "margin-top": "16px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": `1px solid ${props.error ? "#5c2626" : "#333"}`,
          background: props.error ? "#2a1515" : "#1a1a1a",
        }}
      >
        <span style={{ color: props.error ? "#f87171" : "#86efac" }}>
          {props.error ? "✗" : "✓"}
        </span>
        <span style={{ "font-size": "12px", "font-weight": 500, color: "#fff" }}>
          {props.error ? "Error" : "Output"}
        </span>
      </div>
      <div
        ref={containerRef}
        style={{
          height: "200px",
          padding: "8px",
        }}
      />
    </div>
  );
};

const SiteCard = (props: { site: WebflowSite }): JSXElement => (
  <div
    style={{
      background: "#2a2a2a",
      "border-radius": "8px",
      padding: "20px",
      cursor: "pointer",
      transition: "background 0.2s",
    }}
  >
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "12px",
        "margin-bottom": "12px",
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          background: "#4353ff",
          "border-radius": "8px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "font-size": "18px",
        }}
      >
        🌐
      </div>
      <div>
        <div
          style={{
            "font-weight": 500,
            color: "#fff",
            "font-size": "14px",
          }}
        >
          {props.site.displayName}
        </div>
        <div style={{ "font-size": "12px", color: "#888" }}>
          {props.site.shortName}
        </div>
      </div>
    </div>
  </div>
);
