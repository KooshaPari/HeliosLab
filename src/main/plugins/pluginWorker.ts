/**
 * Plugin Worker - runs in an isolated Bun Worker
 *
 * This worker loads and executes a plugin in isolation, providing
 * a controlled API surface for the plugin to interact with Colab.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  PluginAPI,
  PluginManifest,
  Disposable,
  WorkspaceFolder,
  EditorInfo,
  FileChangeEvent,
} from './types';

// ============================================================================
// Worker State
// ============================================================================

let pluginModule: {
  activate?: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
} | null = null;

let pluginName: string = '';
let pluginManifest: PluginManifest | null = null;

const commandHandlers: Map<string, (...args: unknown[]) => unknown> = new Map();
const eventDisposables: Map<string, Set<Disposable>> = new Map();
const pendingRequests: Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}> = new Map();

let requestIdCounter = 0;

// ============================================================================
// Communication with Main Process
// ============================================================================

function sendMessage(message: WorkerToMainMessage): void {
  self.postMessage(message);
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  sendMessage({ type: 'log', level, message, args });
}

async function requestFromMain(method: string, params: unknown): Promise<unknown> {
  const requestId = `req_${++requestIdCounter}`;

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    sendMessage({
      type: 'request',
      requestId,
      method,
      params,
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${method}`));
      }
    }, 30000);
  });
}

// ============================================================================
// Plugin API Factory
// ============================================================================

function createPluginAPI(manifest: PluginManifest): PluginAPI {
  const permissions = manifest.permissions || {};

  // Helper to check permission
  const requirePermission = (perm: string, level: string, required: string[]) => {
    if (!required.includes(level)) {
      throw new Error(`Permission denied: ${perm} access required`);
    }
  };

  const api: PluginAPI = {
    plugin: Object.freeze({
      name: pluginName,
      version: '', // Will be set from manifest
    }),

    commands: {
      registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        // Namespace the command if not already
        const fullId = id.includes('.') ? id : `${pluginName}.${id}`;
        commandHandlers.set(fullId, handler);
        return {
          dispose: () => {
            commandHandlers.delete(fullId);
          },
        };
      },

      async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
        // Try local handler first
        const handler = commandHandlers.get(id);
        if (handler) {
          return handler(...args) as T;
        }
        // Otherwise request from main
        return requestFromMain('commands.execute', { id, args }) as Promise<T>;
      },
    },

    workspace: {
      async getWorkspaceFolders(): Promise<WorkspaceFolder[]> {
        return requestFromMain('workspace.getWorkspaceFolders', {}) as Promise<WorkspaceFolder[]>;
      },

      async readFile(path: string): Promise<string> {
        requirePermission('fs', permissions.fs || 'none', ['readonly', 'readwrite']);
        return requestFromMain('workspace.readFile', { path }) as Promise<string>;
      },

      async writeFile(path: string, content: string): Promise<void> {
        requirePermission('fs', permissions.fs || 'none', ['readwrite']);
        return requestFromMain('workspace.writeFile', { path, content }) as Promise<void>;
      },

      async exists(path: string): Promise<boolean> {
        // exists is allowed with any fs permission
        return requestFromMain('workspace.exists', { path }) as Promise<boolean>;
      },

      async findFiles(pattern: string): Promise<string[]> {
        requirePermission('fs', permissions.fs || 'none', ['readonly', 'readwrite']);
        return requestFromMain('workspace.findFiles', { pattern }) as Promise<string[]>;
      },
    },

    editor: {
      async getActiveEditor(): Promise<EditorInfo | null> {
        return requestFromMain('editor.getActiveEditor', {}) as Promise<EditorInfo | null>;
      },

      async getSelection(): Promise<string | null> {
        return requestFromMain('editor.getSelection', {}) as Promise<string | null>;
      },

      async insertText(text: string): Promise<void> {
        return requestFromMain('editor.insertText', { text }) as Promise<void>;
      },
    },

    terminal: {
      async createTerminal(options: { name?: string; cwd?: string }): Promise<string> {
        requirePermission('terminal', permissions.terminal || 'none', ['readonly', 'readwrite']);
        return requestFromMain('terminal.createTerminal', options) as Promise<string>;
      },

      async sendText(terminalId: string, text: string): Promise<void> {
        requirePermission('terminal', permissions.terminal || 'none', ['readwrite']);
        return requestFromMain('terminal.sendText', { terminalId, text }) as Promise<void>;
      },
    },

    shell: {
      async exec(
        command: string,
        options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        // Note: entitlements are checked on the main process side
        return requestFromMain('shell.exec', { command, options }) as Promise<{
          stdout: string;
          stderr: string;
          exitCode: number;
        }>;
      },

      async openExternal(target: string): Promise<void> {
        return requestFromMain('shell.openExternal', { target }) as Promise<void>;
      },
    },

    notifications: {
      showInfo(message: string): void {
        if (permissions.notifications !== false) {
          requestFromMain('notifications.showInfo', { message });
        }
      },

      showWarning(message: string): void {
        if (permissions.notifications !== false) {
          requestFromMain('notifications.showWarning', { message });
        }
      },

      showError(message: string): void {
        if (permissions.notifications !== false) {
          requestFromMain('notifications.showError', { message });
        }
      },
    },

    log: {
      debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
      info: (message: string, ...args: unknown[]) => log('info', message, ...args),
      warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
      error: (message: string, ...args: unknown[]) => log('error', message, ...args),
    },

    git: {
      async getStatus(repoRoot: string): Promise<unknown> {
        requirePermission('git', permissions.git || 'none', ['readonly', 'readwrite']);
        return requestFromMain('git.getStatus', { repoRoot });
      },

      async getBranch(repoRoot: string): Promise<string> {
        requirePermission('git', permissions.git || 'none', ['readonly', 'readwrite']);
        return requestFromMain('git.getBranch', { repoRoot }) as Promise<string>;
      },
    },

    configuration: {
      async get<T>(key: string): Promise<T | undefined> {
        return requestFromMain('configuration.get', { key }) as Promise<T | undefined>;
      },

      async update(key: string, value: unknown): Promise<void> {
        return requestFromMain('configuration.update', { key, value }) as Promise<void>;
      },
    },

    events: {
      onFileChange(callback: (event: FileChangeEvent) => void): Disposable {
        const eventType = 'fileChange';
        if (!eventDisposables.has(eventType)) {
          eventDisposables.set(eventType, new Set());
        }
        const disposable: Disposable & { callback: typeof callback } = {
          callback,
          dispose: () => {
            eventDisposables.get(eventType)?.delete(disposable);
          },
        };
        eventDisposables.get(eventType)!.add(disposable);
        return disposable;
      },

      onActiveEditorChange(callback: (editor: EditorInfo | null) => void): Disposable {
        const eventType = 'activeEditorChange';
        if (!eventDisposables.has(eventType)) {
          eventDisposables.set(eventType, new Set());
        }
        const disposable: Disposable & { callback: typeof callback } = {
          callback,
          dispose: () => {
            eventDisposables.get(eventType)?.delete(disposable);
          },
        };
        eventDisposables.get(eventType)!.add(disposable);
        return disposable;
      },
    },
  };

  // Freeze the API to prevent modification
  return Object.freeze(api);
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (event: MessageEvent<MainToWorkerMessage & { requestId?: string }>) => {
  const message = event.data;

  switch (message.type) {
    case 'activate': {
      try {
        pluginName = message.pluginName;
        const config = message.config as {
          entryPath: string;
          manifest: PluginManifest;
        };
        pluginManifest = config.manifest;

        log('info', `Loading plugin from ${config.entryPath}`);

        // Dynamically import the plugin
        pluginModule = await import(config.entryPath);

        if (!pluginModule.activate) {
          log('warn', 'Plugin has no activate function');
        }

        // Create the API and call activate
        const api = createPluginAPI(config.manifest);

        if (pluginModule.activate) {
          await pluginModule.activate(api);
        }

        sendMessage({ type: 'activated' });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log('error', `Activation failed: ${errorMsg}`);
        sendMessage({ type: 'error', error: errorMsg });
      }
      break;
    }

    case 'deactivate': {
      try {
        if (pluginModule?.deactivate) {
          await pluginModule.deactivate();
        }

        // Clear all disposables
        for (const disposables of eventDisposables.values()) {
          for (const d of disposables) {
            d.dispose();
          }
        }
        eventDisposables.clear();
        commandHandlers.clear();

        sendMessage({ type: 'deactivated' });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log('error', `Deactivation failed: ${errorMsg}`);
        sendMessage({ type: 'error', error: errorMsg });
      }
      break;
    }

    case 'command': {
      const { commandId, args, requestId } = message as typeof message & { requestId: string };
      try {
        const handler = commandHandlers.get(commandId);
        if (!handler) {
          throw new Error(`Command not found: ${commandId}`);
        }
        const result = await handler(...(args || []));
        // Response is handled by main process
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        sendMessage({ type: 'error', error: errorMsg });
      }
      break;
    }

    case 'event': {
      const { eventType, payload } = message;
      const disposables = eventDisposables.get(eventType);
      if (disposables) {
        for (const d of disposables) {
          try {
            (d as any).callback(payload);
          } catch (error) {
            log('error', `Event handler error: ${error}`);
          }
        }
      }
      break;
    }

    case 'response': {
      const { requestId, result, error } = message;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pendingRequests.delete(requestId);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      }
      break;
    }
  }
};

// Signal that worker is ready
sendMessage({ type: 'ready' });
