/**
 * Plugin system types for Colab
 *
 * Plugins are npm packages with a "colab-plugin" field in package.json.
 * They run in isolated Bun Workers with a controlled API surface.
 */

// ============================================================================
// Manifest Types (package.json "colab-plugin" field)
// ============================================================================

export interface PluginManifest {
  /** Plugin display name */
  displayName?: string;
  /** Plugin description */
  description?: string;
  /** Entry point file (relative to package root, defaults to "main" or "dist/index.js") */
  main?: string;
  /** Icon URL or path */
  icon?: string;
  /** What the plugin contributes to Colab */
  contributes?: PluginContributes;
  /**
   * Declared entitlements - what the plugin claims it needs access to.
   * NOTE: These are NOT enforced. They are displayed to users so they can
   * make informed trust decisions. Only install plugins from trusted sources.
   */
  entitlements?: PluginEntitlements;
  /** @deprecated Use entitlements instead */
  permissions?: PluginPermissions;
  /** Activation events - when should this plugin be loaded */
  activationEvents?: ActivationEvent[];
}

export interface PluginContributes {
  /** Commands the plugin registers */
  commands?: PluginCommand[];
  /** Language IDs the plugin supports */
  languageSupport?: string[];
  /** Webview lifecycle hooks */
  webviewHooks?: WebviewHook[];
  /** File tree contributions */
  fileTree?: FileTreeContribution[];
  /** Editor contributions */
  editor?: EditorContribution[];
  /** Terminal contributions */
  terminal?: TerminalContribution[];
  /** Settings/configuration schema */
  configuration?: PluginConfigurationSchema;
}

export interface PluginCommand {
  /** Unique command ID (namespaced: "myPlugin.doThing") */
  id: string;
  /** Display title for command palette */
  title: string;
  /** Optional category for grouping */
  category?: string;
  /** Keyboard shortcut (e.g., "Cmd+Shift+L") */
  keybinding?: string;
}

export type WebviewHook =
  | 'beforeNavigate'
  | 'afterNavigate'
  | 'onLoad'
  | 'onUnload';

export type FileTreeContribution =
  | 'contextMenuItems'
  | 'decorations'
  | 'dragDrop';

export type EditorContribution =
  | 'codeActions'
  | 'completions'
  | 'diagnostics'
  | 'hover'
  | 'formatting'
  | 'codeLen';

export type TerminalContribution =
  | 'ptyHooks'
  | 'shellIntegration';

export interface PluginConfigurationSchema {
  /** JSON Schema for plugin settings */
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    default?: unknown;
    description?: string;
    enum?: unknown[];
  }>;
}

// ============================================================================
// Entitlements (Declared Capabilities - NOT Enforced)
// ============================================================================

/**
 * Plugin entitlements declare what capabilities a plugin claims to need.
 *
 * IMPORTANT: These are NOT enforced by Colab. Plugins run with full Bun runtime
 * access and can technically do anything. Entitlements are displayed to users
 * so they can make informed trust decisions about installing plugins.
 *
 * Only install plugins from sources you trust.
 */
export interface PluginEntitlements {
  /** File system access */
  filesystem?: {
    /** Plugin reads files from the workspace */
    read?: boolean;
    /** Plugin writes/modifies files in the workspace */
    write?: boolean;
    /** Plugin accesses files outside the workspace */
    fullAccess?: boolean;
    /** Optional explanation of why this is needed */
    reason?: string;
  };

  /** Network access */
  network?: {
    /** Plugin makes HTTP/HTTPS requests */
    internet?: boolean;
    /** Specific domains the plugin connects to (informational) */
    domains?: string[];
    /** Optional explanation */
    reason?: string;
  };

  /** Process/shell execution */
  process?: {
    /** Plugin spawns child processes or runs shell commands */
    spawn?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Terminal integration */
  terminal?: {
    /** Plugin reads terminal output */
    read?: boolean;
    /** Plugin sends input to terminals */
    write?: boolean;
    /** Plugin registers terminal commands */
    commands?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Environment and system */
  system?: {
    /** Plugin reads environment variables */
    environment?: boolean;
    /** Plugin accesses system information */
    systemInfo?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Webview/browser integration */
  webview?: {
    /** Plugin injects scripts into web pages */
    scriptInjection?: boolean;
    /** Plugin intercepts/modifies web requests */
    requestInterception?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** AI/LLM access */
  ai?: {
    /** Plugin uses local AI models */
    localModels?: boolean;
    /** Plugin sends data to external AI services */
    externalServices?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Sensitive data */
  sensitive?: {
    /** Plugin may access credentials/tokens */
    credentials?: boolean;
    /** Plugin accesses clipboard */
    clipboard?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** UI contributions */
  ui?: {
    /** Plugin adds status bar items */
    statusBar?: boolean;
    /** Plugin adds context menu items */
    contextMenu?: boolean;
    /** Plugin adds file tree decorations/badges */
    fileDecorations?: boolean;
    /** Plugin shows notifications */
    notifications?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Editor contributions */
  editor?: {
    /** Plugin provides code completions/snippets */
    completions?: boolean;
    /** Plugin provides hover information */
    hover?: boolean;
    /** Plugin provides code actions */
    codeActions?: boolean;
    /** Plugin provides diagnostics/linting */
    diagnostics?: boolean;
    /** Optional explanation */
    reason?: string;
  };

  /** Keyboard shortcuts */
  keybindings?: {
    /** Plugin registers global keyboard shortcuts */
    global?: boolean;
    /** Plugin registers editor-specific shortcuts */
    editor?: boolean;
    /** Optional explanation */
    reason?: string;
  };
}

/**
 * Get a human-readable summary of entitlements for display
 */
export function summarizeEntitlements(entitlements: PluginEntitlements | undefined): EntitlementSummary[] {
  if (!entitlements) return [];

  const summary: EntitlementSummary[] = [];

  if (entitlements.filesystem) {
    const fs = entitlements.filesystem;
    if (fs.fullAccess) {
      summary.push({
        category: 'filesystem',
        level: 'high',
        icon: '📁',
        label: 'Full File System Access',
        description: fs.reason || 'Can read and write files anywhere on your system',
      });
    } else if (fs.write) {
      summary.push({
        category: 'filesystem',
        level: 'medium',
        icon: '📝',
        label: 'File Read/Write',
        description: fs.reason || 'Can read and modify files in your workspace',
      });
    } else if (fs.read) {
      summary.push({
        category: 'filesystem',
        level: 'low',
        icon: '📖',
        label: 'File Read',
        description: fs.reason || 'Can read files in your workspace',
      });
    }
  }

  if (entitlements.network) {
    const net = entitlements.network;
    if (net.internet) {
      const domains = net.domains?.length ? ` (${net.domains.join(', ')})` : '';
      summary.push({
        category: 'network',
        level: 'medium',
        icon: '🌐',
        label: 'Network Access' + domains,
        description: net.reason || 'Can make requests to the internet',
      });
    }
  }

  if (entitlements.process?.spawn) {
    summary.push({
      category: 'process',
      level: 'high',
      icon: '⚙️',
      label: 'Run Processes',
      description: entitlements.process.reason || 'Can execute shell commands and spawn processes',
    });
  }

  if (entitlements.terminal) {
    const term = entitlements.terminal;
    if (term.write) {
      summary.push({
        category: 'terminal',
        level: 'medium',
        icon: '💻',
        label: 'Terminal Control',
        description: term.reason || 'Can send commands to terminals',
      });
    } else if (term.read || term.commands) {
      summary.push({
        category: 'terminal',
        level: 'low',
        icon: '💻',
        label: 'Terminal Integration',
        description: term.reason || 'Integrates with the terminal',
      });
    }
  }

  if (entitlements.system) {
    const sys = entitlements.system;
    if (sys.environment) {
      summary.push({
        category: 'system',
        level: 'medium',
        icon: '🔧',
        label: 'Environment Access',
        description: sys.reason || 'Can read environment variables',
      });
    }
  }

  if (entitlements.webview) {
    const wv = entitlements.webview;
    if (wv.scriptInjection) {
      summary.push({
        category: 'webview',
        level: 'medium',
        icon: '🔌',
        label: 'Web Page Scripts',
        description: wv.reason || 'Injects scripts into web pages you visit',
      });
    }
    if (wv.requestInterception) {
      summary.push({
        category: 'webview',
        level: 'high',
        icon: '🔍',
        label: 'Web Request Access',
        description: wv.reason || 'Can intercept web requests',
      });
    }
  }

  if (entitlements.ai) {
    const ai = entitlements.ai;
    if (ai.externalServices) {
      summary.push({
        category: 'ai',
        level: 'medium',
        icon: '🤖',
        label: 'External AI Services',
        description: ai.reason || 'Sends data to external AI services',
      });
    } else if (ai.localModels) {
      summary.push({
        category: 'ai',
        level: 'low',
        icon: '🤖',
        label: 'Local AI Models',
        description: ai.reason || 'Uses local AI models',
      });
    }
  }

  if (entitlements.sensitive) {
    const sens = entitlements.sensitive;
    if (sens.credentials) {
      summary.push({
        category: 'sensitive',
        level: 'high',
        icon: '🔑',
        label: 'Credential Access',
        description: sens.reason || 'May access stored credentials or tokens',
      });
    }
    if (sens.clipboard) {
      summary.push({
        category: 'sensitive',
        level: 'medium',
        icon: '📋',
        label: 'Clipboard Access',
        description: sens.reason || 'Can read from or write to clipboard',
      });
    }
  }

  if (entitlements.ui) {
    const ui = entitlements.ui;
    const features: string[] = [];
    if (ui.statusBar) features.push('status bar');
    if (ui.contextMenu) features.push('context menus');
    if (ui.fileDecorations) features.push('file badges');
    if (ui.notifications) features.push('notifications');
    if (features.length > 0) {
      summary.push({
        category: 'ui',
        level: 'low',
        icon: '🎨',
        label: 'UI Elements',
        description: ui.reason || `Adds ${features.join(', ')}`,
      });
    }
  }

  if (entitlements.editor) {
    const ed = entitlements.editor;
    const features: string[] = [];
    if (ed.completions) features.push('completions');
    if (ed.hover) features.push('hover info');
    if (ed.codeActions) features.push('code actions');
    if (ed.diagnostics) features.push('diagnostics');
    if (features.length > 0) {
      summary.push({
        category: 'editor',
        level: 'low',
        icon: '✏️',
        label: 'Editor Features',
        description: ed.reason || `Provides ${features.join(', ')}`,
      });
    }
  }

  if (entitlements.keybindings) {
    const kb = entitlements.keybindings;
    if (kb.global || kb.editor) {
      summary.push({
        category: 'keybindings',
        level: 'low',
        icon: '⌨️',
        label: 'Keyboard Shortcuts',
        description: kb.reason || `Registers ${kb.global ? 'global' : 'editor'} keyboard shortcuts`,
      });
    }
  }

  return summary;
}

export interface EntitlementSummary {
  category: string;
  level: 'low' | 'medium' | 'high';
  icon: string;
  label: string;
  description: string;
}

// ============================================================================
// Legacy Permissions (deprecated, kept for compatibility)
// ============================================================================

/** @deprecated Use PluginEntitlements instead */
export interface PluginPermissions {
  /** File system access level */
  fs?: 'none' | 'readonly' | 'readwrite';
  /** Network access */
  network?: 'none' | 'allow';
  /** AI model access */
  aiModels?: 'none' | 'allow';
  /** Clipboard access */
  clipboard?: 'none' | 'read' | 'readwrite';
  /** Git operations */
  git?: 'none' | 'readonly' | 'readwrite';
  /** Terminal access */
  terminal?: 'none' | 'readonly' | 'readwrite';
  /** Can show notifications */
  notifications?: boolean;
}

/** @deprecated */
export const DEFAULT_PERMISSIONS: PluginPermissions = {
  fs: 'none',
  network: 'none',
  aiModels: 'none',
  clipboard: 'none',
  git: 'none',
  terminal: 'none',
  notifications: false,
};

// ============================================================================
// Activation Events
// ============================================================================

export type ActivationEvent =
  | '*'  // Always activate on startup
  | `onCommand:${string}`
  | `onLanguage:${string}`
  | `onFileOpen:${string}`  // glob pattern
  | `workspaceContains:${string}`;  // glob pattern

// ============================================================================
// Plugin Runtime Types
// ============================================================================

export type PluginState =
  | 'installed'     // Downloaded but not loaded
  | 'activating'    // Worker starting, calling activate()
  | 'active'        // Running
  | 'deactivating'  // Calling deactivate()
  | 'inactive'      // Loaded but not running
  | 'error';        // Failed to load/activate

export interface InstalledPlugin {
  /** npm package name */
  name: string;
  /** npm package version */
  version: string;
  /** Resolved manifest from package.json */
  manifest: PluginManifest;
  /** Path to installed package */
  installPath: string;
  /** Current state */
  state: PluginState;
  /** Error message if state is 'error' */
  error?: string;
  /** Whether plugin is enabled by user */
  enabled: boolean;
  /** When the plugin was installed */
  installedAt: number;
  /** When the plugin was last updated */
  updatedAt: number;
  /** Whether this is a local/dev plugin installed from a folder */
  isLocal?: boolean;
  /** Original local path if installed from folder */
  localPath?: string;
}

// ============================================================================
// Plugin Registry (persisted)
// ============================================================================

export interface PluginRegistry {
  /** Schema version for migrations */
  version: number;
  /** Installed plugins by name */
  plugins: Record<string, InstalledPlugin>;
}

// ============================================================================
// Worker Message Types (Main <-> Worker communication)
// ============================================================================

export type MainToWorkerMessage =
  | { type: 'activate'; pluginName: string; config: unknown }
  | { type: 'deactivate' }
  | { type: 'command'; commandId: string; args?: unknown[] }
  | { type: 'event'; eventType: string; payload: unknown }
  | { type: 'response'; requestId: string; result?: unknown; error?: string };

export type WorkerToMainMessage =
  | { type: 'ready' }
  | { type: 'activated' }
  | { type: 'deactivated' }
  | { type: 'error'; error: string }
  | { type: 'request'; requestId: string; method: string; params: unknown }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; args?: unknown[] };

// ============================================================================
// Plugin API Types (what plugins can call)
// ============================================================================

export interface PluginAPI {
  /** Plugin metadata */
  readonly plugin: {
    readonly name: string;
    readonly version: string;
  };

  /** Commands registration and execution */
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };

  /** Webview operations */
  webview: {
    /** Register a preload script to be injected into all webviews */
    registerPreloadScript(script: string): Disposable;
  };

  /** Workspace operations (scoped by permissions) */
  workspace: {
    /** Get open workspace folders */
    getWorkspaceFolders(): Promise<WorkspaceFolder[]>;
    /** Read a file (requires fs permission) */
    readFile(path: string): Promise<string>;
    /** Write a file (requires fs:readwrite permission) */
    writeFile(path: string, content: string): Promise<void>;
    /** Check if file exists */
    exists(path: string): Promise<boolean>;
    /** Find files matching pattern */
    findFiles(pattern: string): Promise<string[]>;
  };

  /** Editor operations */
  editor: {
    /** Get active editor info */
    getActiveEditor(): Promise<EditorInfo | null>;
    /** Get selected text in active editor */
    getSelection(): Promise<string | null>;
    /** Insert text at cursor position */
    insertText(text: string): Promise<void>;
    /**
     * Register a completion item provider for code suggestions
     * @param languages - Array of language IDs (e.g., ['typescript', 'javascript'])
     * @param provider - The completion provider
     */
    registerCompletionProvider(
      languages: string[],
      provider: CompletionProvider
    ): Disposable;
  };

  /** Terminal operations (requires terminal permission) */
  terminal: {
    /** Create a new terminal */
    createTerminal(options: { name?: string; cwd?: string }): Promise<string>;
    /** Send text to terminal */
    sendText(terminalId: string, text: string): Promise<void>;
    /**
     * Register a terminal command that can be invoked by typing its name in any terminal.
     * The handler receives a context object with args, cwd, write function, etc.
     * @param name - Command name (e.g., "catify" - user types "catify" in terminal)
     * @param handler - Function that handles the command
     */
    registerCommand(
      name: string,
      handler: (ctx: TerminalCommandContext) => void | Promise<void>
    ): Disposable;
  };

  /** Shell operations (requires process.spawn permission) */
  shell: {
    /**
     * Execute a shell command and return the result
     * @param command - The command to execute
     * @param options - Execution options
     * @returns Promise with stdout, stderr, and exit code
     */
    exec(
      command: string,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeout?: number;
      }
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    /**
     * Open a URL in the default browser or a file with its default application
     * @param target - URL or file path to open
     */
    openExternal(target: string): Promise<void>;
  };

  /** UI notifications */
  notifications: {
    /** Show info message */
    showInfo(message: string): void;
    /** Show warning message */
    showWarning(message: string): void;
    /** Show error message */
    showError(message: string): void;
  };

  /** Logging (always available) */
  log: {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };

  /** Git operations (requires git permission) */
  git: {
    getStatus(repoRoot: string): Promise<unknown>;
    getBranch(repoRoot: string): Promise<string>;
  };

  /** Configuration */
  configuration: {
    get<T>(key: string): Promise<T | undefined>;
    update(key: string, value: unknown): Promise<void>;
  };

  /** Events subscription */
  events: {
    onFileChange(callback: (event: FileChangeEvent) => void): Disposable;
    onActiveEditorChange(callback: (editor: EditorInfo | null) => void): Disposable;
  };

  /** Status bar operations */
  statusBar: {
    /** Create a status bar item */
    createItem(item: StatusBarItem): StatusBarItemHandle;
  };

  /** File tree decorations */
  fileDecorations: {
    /** Register a file decoration provider */
    registerProvider(provider: FileDecorationProvider): Disposable;
  };

  /** Context menu operations */
  contextMenu: {
    /**
     * Register a context menu item
     * @param item - The menu item configuration
     * @param handler - Called when the menu item is clicked, receives the file path or selection
     */
    registerItem(
      item: ContextMenuItem,
      handler: (context: { filePath?: string; selection?: string }) => void | Promise<void>
    ): Disposable;
  };

  /** Keyboard shortcuts */
  keybindings: {
    /**
     * Register a keyboard shortcut
     * @param shortcut - The shortcut configuration
     */
    register(shortcut: KeyboardShortcut): Disposable;
  };

  /** Plugin settings */
  settings: {
    /**
     * Register a settings schema for this plugin.
     * This creates a settings panel accessible from the status bar or extensions menu.
     * @param schema - The settings schema definition
     */
    registerSchema(schema: PluginSettingsSchema): Disposable;
    /**
     * Get a setting value
     * @param key - Setting key
     * @returns The current value, or the default if not set
     */
    get<T extends string | number | boolean>(key: string): T | undefined;
    /**
     * Set a setting value
     * @param key - Setting key
     * @param value - New value
     */
    set(key: string, value: string | number | boolean): void;
    /**
     * Get all settings for this plugin
     */
    getAll(): PluginSettingsValues;
    /**
     * Subscribe to settings changes
     * @param callback - Called when any setting changes
     */
    onChange(callback: (key: string, value: string | number | boolean) => void): Disposable;
    /**
     * Set validation status for a setting (shown inline in settings panel)
     * Use this to show validation feedback for tokens/credentials
     * @param key - Setting key
     * @param status - Validation status
     */
    setValidationStatus(key: string, status: SettingValidationStatus): void;
    /**
     * Send a message to the settings UI (for custom settings components)
     * @param message - Message payload (must be JSON-serializable)
     */
    postMessage(message: unknown): void;
    /**
     * Subscribe to messages from the settings UI
     * @param callback - Called when a message is received from the settings UI
     */
    onMessage(callback: (message: unknown) => void): Disposable;
  };

  /** Custom slate registration (for custom file handlers/UIs) */
  slates: {
    /**
     * Register a custom slate handler for specific file patterns.
     * When a file matches the pattern, the plugin's slate UI is shown
     * instead of the default text editor.
     * @param config - Slate configuration including patterns and component name
     */
    register(config: SlateConfig): Disposable;
    /**
     * Register a callback for when a slate instance should mount.
     * This is called when the user opens a file/folder that matches your slate patterns.
     * @param slateId - The slate ID (without plugin prefix, e.g., "devlink")
     * @param handler - Called with context including instanceId, filePath, state, settings
     */
    onMount(slateId: string, handler: (context: SlateContext) => void | Promise<void>): Disposable;
    /**
     * Register a callback for when a slate instance should unmount.
     * Use this to clean up any resources associated with the instance.
     * @param slateId - The slate ID (without plugin prefix)
     * @param handler - Called with the instanceId being unmounted
     */
    onUnmount(slateId: string, handler: (instanceId: string) => void | Promise<void>): Disposable;
    /**
     * Register a callback for events from the slate UI.
     * When the user interacts with elements in your slate, events are sent here.
     * @param slateId - The slate ID (without plugin prefix)
     * @param handler - Called with instanceId, eventType, and payload
     */
    onEvent(slateId: string, handler: (instanceId: string, eventType: string, payload: unknown) => void | Promise<void>): Disposable;
    /**
     * Render HTML content into a slate instance.
     * Call this from your onMount handler or event handlers to update the UI.
     * @param instanceId - The instance ID (from SlateContext or event handler)
     * @param html - HTML content to render
     * @param script - Optional JavaScript to execute after render
     */
    render(instanceId: string, html: string, script?: string): void;
  };

  /** Arbitrary state storage for complex plugin data (arrays, objects, etc.) */
  state: {
    /**
     * Get a value from plugin state
     * @param key - State key
     * @returns The stored value, or undefined if not set
     */
    get<T = unknown>(key: string): T | undefined;
    /**
     * Set a value in plugin state (must be JSON-serializable)
     * @param key - State key
     * @param value - Value to store
     */
    set<T = unknown>(key: string, value: T): void;
    /**
     * Delete a value from plugin state
     * @param key - State key
     */
    delete(key: string): void;
    /**
     * Get all state for this plugin
     */
    getAll(): Record<string, unknown>;
  };

  /** Paths to bundled binaries and directories */
  paths: {
    /** Path to bundled bun binary */
    bun: string;
    /** Path to bundled git binary */
    git: string;
    /** Path to bundled fd binary (fast find) */
    fd: string;
    /** Path to bundled rg binary (ripgrep) */
    rg: string;
    /** Colab home folder (~/.colab or ~/.colab-canary) */
    colabHome: string;
    /** Colab plugins folder */
    plugins: string;
  };

  /** UI operations (opening tabs, etc.) */
  ui: {
    /**
     * Open a URL in a new web tab within Colab
     * @param url - The URL to open
     */
    openUrl(url: string): void;
  };

  /** Utility functions */
  utils: {
    /**
     * Get a unique name for a new file/folder in a directory
     * If baseName already exists, returns "1-baseName", "2-baseName", etc.
     * @param parentPath - Parent directory path
     * @param baseName - Desired base name
     * @returns A unique name that doesn't conflict with existing entries
     */
    getUniqueNewName(parentPath: string, baseName: string): string;
  };
}

/** Handle to update or dispose a status bar item */
export interface StatusBarItemHandle extends Disposable {
  /** Update the item's text */
  update(item: Partial<Omit<StatusBarItem, 'id'>>): void;
}

// ============================================================================
// Supporting Types
// ============================================================================

export interface Disposable {
  dispose(): void;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface EditorInfo {
  path: string;
  languageId: string;
  isDirty: boolean;
}

export interface FileChangeEvent {
  path: string;
  type: 'created' | 'changed' | 'deleted';
}

export interface TerminalCommandContext {
  /** Command arguments (space-separated, excluding the command name) */
  args: string[];
  /** Current working directory of the terminal */
  cwd: string;
  /** Terminal ID */
  terminalId: string;
  /** Write output to the terminal (supports ANSI escape codes) */
  write: (text: string) => void;
}

export interface CompletionContext {
  /** The text before the cursor on the current line */
  linePrefix: string;
  /** The full line text */
  lineText: string;
  /** Line number (1-indexed) */
  lineNumber: number;
  /** Column number (1-indexed) */
  column: number;
  /** The file path */
  filePath: string;
  /** The trigger character if any */
  triggerCharacter?: string;
}

export interface CompletionItem {
  /** The label shown in the completion list */
  label: string;
  /** The text to insert when selected */
  insertText: string;
  /** Optional detail shown next to the label */
  detail?: string;
  /** Optional documentation shown in the details pane */
  documentation?: string;
  /** Kind of completion (e.g., 'function', 'snippet', 'text') */
  kind?: 'function' | 'snippet' | 'text' | 'keyword' | 'variable' | 'class' | 'method' | 'property';
  /** Characters that trigger this completion (e.g., ['.']) */
  triggerCharacters?: string[];
}

export interface CompletionProvider {
  /** Trigger characters that activate this provider */
  triggerCharacters?: string[];
  /**
   * Provide completion items
   * @param context - Information about the cursor position and surrounding text
   * @returns Array of completion items, or empty array for no completions
   */
  provideCompletions(context: CompletionContext): CompletionItem[] | Promise<CompletionItem[]>;
}

export interface StatusBarItem {
  /** Unique ID for this status bar item */
  id: string;
  /** Text to display */
  text: string;
  /** Optional tooltip */
  tooltip?: string;
  /** Optional color (CSS color string) */
  color?: string;
  /** Priority for ordering (higher = more to the left). Default: 0 */
  priority?: number;
  /** Alignment: 'left' or 'right'. Default: 'right' */
  alignment?: 'left' | 'right';
}

export interface FileDecoration {
  /** Badge text (1-2 characters, e.g., "M", "!", "★") */
  badge?: string;
  /** Badge color (CSS color string) */
  badgeColor?: string;
  /** Tooltip when hovering over the decoration */
  tooltip?: string;
  /** Whether to dim/fade the file name */
  faded?: boolean;
  /** Color for the file name (CSS color string) */
  color?: string;
}

export interface FileDecorationProvider {
  /**
   * Provide decorations for a file
   * @param filePath - Absolute path to the file
   * @returns Decoration for this file, or undefined for no decoration
   */
  provideDecoration(filePath: string): FileDecoration | undefined | Promise<FileDecoration | undefined>;
}

export interface ContextMenuItem {
  /** Unique ID for this menu item */
  id: string;
  /** Display label */
  label: string;
  /** Context where this item appears: 'editor', 'fileTree', or 'both' */
  context: 'editor' | 'fileTree' | 'both';
  /** Optional keyboard shortcut hint to display */
  shortcutHint?: string;
}

export interface KeyboardShortcut {
  /** Key combination (e.g., 'ctrl+shift+m', 'cmd+k cmd+c') */
  key: string;
  /** Command ID to execute when triggered */
  command: string;
  /** Optional context where this shortcut is active: 'editor', 'terminal', 'global'. Default: 'global' */
  when?: 'editor' | 'terminal' | 'global';
}

// ============================================================================
// Plugin Settings Types
// ============================================================================

/** A single setting field definition */
export interface PluginSettingField {
  /** Unique key for this setting */
  key: string;
  /** Display label */
  label: string;
  /** Field type. Use 'secret' for passwords/tokens that should be masked */
  type: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'secret';
  /** Default value */
  default?: string | number | boolean;
  /** Description/help text */
  description?: string;
  /** For 'select' type: available options */
  options?: Array<{ label: string; value: string | number }>;
  /** For 'number' type: min value */
  min?: number;
  /** For 'number' type: max value */
  max?: number;
  /** For 'number' type: step value */
  step?: number;
  /** For 'secret' type: placeholder text */
  placeholder?: string;
}

/** Plugin settings schema for the settings panel */
export interface PluginSettingsSchema {
  /** Section title (displayed in settings panel) */
  title?: string;
  /** Section description */
  description?: string;
  /** Setting fields */
  fields: PluginSettingField[];
  /**
   * Custom settings component to render below the schema-based fields.
   * This should be the name of a registered component (e.g., 'webflow-tokens').
   * The component will receive the plugin name and can use RPC to communicate with the plugin.
   */
  customSettingsComponent?: string;
}

/** Stored settings values for a plugin */
export type PluginSettingsValues = Record<string, string | number | boolean>

/** Validation status for a setting field (shown inline in settings panel) */
export interface SettingValidationStatus {
  /** Validation state */
  state: 'idle' | 'validating' | 'valid' | 'invalid';
  /** Optional message to display */
  message?: string;
}

/** Map of setting keys to their validation status */
export type SettingValidationStatuses = Record<string, SettingValidationStatus>

// ============================================================================
// Slate Registration Types
// ============================================================================

/**
 * Configuration for a plugin-registered slate (custom file handler)
 * When a file matches, the plugin's slate UI is shown instead of the text editor
 */
export interface SlateConfig {
  /** Unique ID for this slate type */
  id: string;
  /** Display name for the slate */
  name: string;
  /** Description shown in UI */
  description?: string;
  /** Icon to show in tab (emoji or icon name) */
  icon?: string;
  /**
   * File matching patterns - slate is shown when ANY pattern matches
   * Can be:
   * - Glob patterns: "*.webflowrc.json", "**\/webflow.json"
   * - Exact filenames: ".webflowrc.json"
   */
  patterns: string[];
  /**
   * Optional: A function to validate file content before showing slate
   * Return true to show slate, false to use default editor
   * If not provided, any matching file will show the slate
   */
  matchContent?: (filePath: string, content: string) => boolean | Promise<boolean>;
  /**
   * @deprecated Use mount-based rendering instead
   * The component name to render for this slate.
   */
  component?: string;
  /**
   * Whether this slate can handle folders (for project-level slates)
   */
  folderHandler?: boolean;
}

/**
 * Context provided to plugin slate when mounting
 */
export interface SlateContext {
  /** Unique instance ID for this slate mount */
  instanceId: string;
  /** The file path this slate is rendering for */
  filePath: string;
  /** The slate ID from SlateConfig */
  slateId: string;
  /** Plugin's current state (from api.state) */
  state: Record<string, unknown>;
  /** Plugin's current settings (from api.settings) */
  settings: Record<string, string | number | boolean>;
}

/**
 * Registered slate with plugin info
 */
export interface RegisteredSlate {
  pluginName: string;
  config: SlateConfig;
}

/**
 * Message sent to plugin when slate should mount
 */
export interface SlateMountMessage {
  type: 'slateMount';
  instanceId: string;
  slateId: string;
  filePath: string;
}

/**
 * Message sent to plugin when slate should unmount
 */
export interface SlateUnmountMessage {
  type: 'slateUnmount';
  instanceId: string;
}

/**
 * Message from plugin to render content into slate
 */
export interface SlateRenderMessage {
  type: 'slateRender';
  instanceId: string;
  /** HTML content to render, or null to clear */
  html?: string;
  /** JavaScript to execute after HTML is rendered */
  script?: string;
}

/**
 * Message from slate UI to plugin (user interactions)
 */
export interface SlateEventMessage {
  type: 'slateEvent';
  instanceId: string;
  eventType: string;
  payload: unknown;
}

// ============================================================================
// npm Registry Types
// ============================================================================

export interface NpmPackageInfo {
  name: string;
  version: string;
  description?: string;
  author?: string | { name: string; email?: string };
  keywords?: string[];
  repository?: { type: string; url: string } | string;
  homepage?: string;
  license?: string;
  /** The colab-plugin field if present */
  'colab-plugin'?: PluginManifest;
}

export interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      author?: { name: string };
      publisher?: { username: string };
      date: string;
    };
    score: {
      final: number;
      detail: {
        quality: number;
        popularity: number;
        maintenance: number;
      };
    };
  }>;
  total: number;
}
