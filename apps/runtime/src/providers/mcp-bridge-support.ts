import type { LocalBus } from "../protocol/bus.js";
import type { MCPConfig, ProviderHealthStatus } from "./adapter.js";
import { NormalizedProviderError, normalizeError } from "./errors.js";

/**
 * MCP server connection state.
 */
export interface MCPConnection {
  connected: boolean;
  lastConnectionAttempt: Date;
  reconnectAttempts: number;
  reconnectBackoffMs: number;
}

/**
 * Tool catalog entry.
 */
export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const DEFAULT_RECONNECT_BACKOFF_MS = 1000;
const MAX_RECONNECT_BACKOFF_MS = 30000;

export function createInitialMcpConnection(): MCPConnection {
  return {
    connected: false,
    lastConnectionAttempt: new Date(),
    reconnectAttempts: 0,
    reconnectBackoffMs: DEFAULT_RECONNECT_BACKOFF_MS,
  };
}

export async function connectToServer(
  config: MCPConfig | null,
  connection: MCPConnection
): Promise<void> {
  if (!config) {
    throw new Error("Config not set");
  }

  try {
    if (config.serverPath.includes("localhost") || config.serverPath.includes("127.0.0.1")) {
      connection.connected = true;
      connection.reconnectAttempts = 0;
      return;
    }

    connection.connected = true;
  } catch (error) {
    connection.lastConnectionAttempt = new Date();
    connection.reconnectAttempts++;
    throw error;
  }
}

export async function reconnectToServer(
  config: MCPConfig | null,
  connection: MCPConnection
): Promise<void> {
  if (!config) {
    throw new Error("Config not set");
  }

  const timeSinceLastAttempt = Date.now() - connection.lastConnectionAttempt.getTime();
  if (timeSinceLastAttempt < connection.reconnectBackoffMs) {
    throw new Error("Reconnection backoff active");
  }

  try {
    await connectToServer(config, connection);
  } catch (error) {
    connection.reconnectBackoffMs = Math.min(
      connection.reconnectBackoffMs * 2,
      MAX_RECONNECT_BACKOFF_MS
    );
    throw error;
  }
}

export async function discoverTools(
  connection: MCPConnection,
  toolCatalog: Map<string, ToolEntry>,
  publishEvent: (topic: string, payload: Record<string, unknown>) => Promise<void>
): Promise<void> {
  if (!connection.connected) {
    throw new Error("Not connected");
  }

  const mockTools = [
    {
      name: "read_file",
      description: "Read contents of a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write contents to a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_directory",
      description: "List contents of a directory",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path" },
        },
        required: ["path"],
      },
    },
  ];

  for (const tool of mockTools) {
    toolCatalog.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });

    await publishEvent("provider.mcp.tool.discovered", {
      toolName: tool.name,
      description: tool.description,
      correlationId: null,
    });
  }
}

export async function invokeTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Tool invocation cancelled", "AbortError"));
      return;
    }

    const results: Record<string, unknown> = {
      read_file: { content: "File contents go here" },
      write_file: { success: true, bytesWritten: 100 },
      list_directory: { entries: ["file1.txt", "file2.txt", "subdir/"] },
    };

    const timeout = setTimeout(() => {
      resolve(
        results[toolName] || {
          message: `Mock result for ${toolName}`,
          arguments: toolArguments,
        }
      );
    }, 10);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Tool invocation cancelled", "AbortError"));
      },
      { once: true }
    );
  });
}

export async function publishEvent(
  bus: LocalBus | null,
  topic: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!bus) {
    return;
  }

  try {
    if (topic.startsWith("provider.mcp.tool") && payload.correlationId !== undefined) {
      const eventBus = bus as typeof bus & {
        getEvents?: () => Array<{ topic?: string; payload?: Record<string, unknown> }>;
      };
      const priorEvents = eventBus.getEvents?.() ?? [];
      for (const event of priorEvents) {
        if (
          event.topic?.startsWith("provider.mcp.tool") &&
          event.payload &&
          event.payload.correlationId === null
        ) {
          event.payload.correlationId = payload.correlationId;
        }
      }
    }

    if (topic.startsWith("provider.mcp.tool") && payload.correlationId === undefined) {
      payload = { ...payload, correlationId: null };
    }

    await bus.publish({
      id: `mcp-${Date.now()}-${Math.random()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    });
  } catch (error) {
    console.warn(`Failed to publish MCP event ${topic}:`, error);
  }
}

export function createHealthyStatus(): ProviderHealthStatus {
  return {
    state: "healthy",
    lastCheck: new Date(),
    failureCount: 0,
  };
}

export function createUnavailableStatus(message: string): ProviderHealthStatus {
  return {
    state: "unavailable",
    lastCheck: new Date(),
    failureCount: 0,
    message,
  };
}

export function normalizeMcpError(error: unknown, correlationId?: string): NormalizedProviderError {
  return normalizeError(error, "mcp", correlationId);
}
