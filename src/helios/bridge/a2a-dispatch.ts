/**
 * Agent Delegation Boundary Dispatcher
 *
 * Routes agent_delegation commands to local agents.
 * Uses ACP client for agent execution.
 * Supports: agent.run, agent.cancel, agent.list, agent.status
 */

import type { LocalBusEnvelope } from "../runtime/protocol/types";
import { AcpClient } from "../runtime/integrations/acp_client/client";
import type { AcpConfig } from "../runtime/integrations/acp_client/adapter";

interface AgentTask {
  id: string;
  taskId: string;
  status: "running" | "completed" | "cancelled" | "errored";
  content?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

const activeAgents = new Map<string, AgentTask>();
let acpClient: AcpClient | null = null;
let acpClientInitialized = false;

function getDefaultAcpConfig(): Partial<AcpConfig> {
  const endpoint = process.env.HELIOS_ACP_ENDPOINT;
  const apiKey = process.env.HELIOS_ACP_API_KEY;

  return {
    endpoint: endpoint || "",
    apiKey: apiKey || "",
  };
}

function errorResponse(command: LocalBusEnvelope, code: string, message: string): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "error",
    result: null,
    error: { code, message, retryable: false, details: { method: command.method } },
  };
}

function successResponse(
  command: LocalBusEnvelope,
  result: Record<string, unknown>,
): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result,
    error: null,
  };
}

export function createA2ADispatch(): CommandDispatch {
  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    const method = command.method;
    const agentId = command.correlation_id || command.id;

    switch (method) {
      case "agent.run": {
        try {
          const payload = command.payload as Record<string, unknown>;
          const message = (payload?.message as string) || "";
          const providedConfig = (payload?.config as Partial<AcpConfig>) || {};

          // Merge provided config with environment defaults
          const envConfig = getDefaultAcpConfig();
          const config: Partial<AcpConfig> = {
            ...envConfig,
            ...providedConfig,
          };

          // Lazy initialize ACP client if not already done
          if (!acpClientInitialized) {
            if (!config.endpoint) {
              return errorResponse(
                command,
                "ACP_NOT_CONFIGURED",
                "ACP endpoint not configured (set HELIOS_ACP_ENDPOINT env " +
                  "var or pass in payload config)",
              );
            }

            acpClient = new AcpClient();
            await acpClient.init({
              endpoint: config.endpoint,
              apiKey: config.apiKey || "",
              model: config.model,
              timeoutMs: config.timeoutMs,
              maxRetries: config.maxRetries,
            });
            acpClientInitialized = true;
          }

          if (!acpClient) {
            return errorResponse(command, "AGENT_RUN_FAILED", "ACP client not initialized");
          }

          const result = await acpClient.execute(message, agentId);

          // Track in activeAgents
          activeAgents.set(agentId, {
            id: agentId,
            taskId: result.taskId,
            status: "completed",
            content: result.content,
            model: result.model,
            usage: result.usage,
          });

          return successResponse(command, {
            agentId,
            content: result.content,
            model: result.model,
            usage: result.usage,
            status: "completed",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResponse(command, "AGENT_RUN_FAILED", `Failed to run agent: ${message}`);
        }
      }

      case "agent.cancel": {
        const agent = activeAgents.get(agentId);
        if (!agent) {
          return errorResponse(command, "AGENT_NOT_FOUND", `Agent ${agentId} not found`);
        }

        try {
          if (acpClient) {
            await acpClient.cancel(agent.taskId);
          }

          agent.status = "cancelled";
          return successResponse(command, {
            agentId,
            status: "cancelled",
            message: "Agent cancelled",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResponse(
            command,
            "AGENT_CANCEL_FAILED",
            `Failed to cancel agent: ${message}`,
          );
        }
      }

      case "agent.list": {
        const agents = Array.from(activeAgents.values()).map((agent) => ({
          id: agent.id,
          status: agent.status,
          taskId: agent.taskId,
        }));

        return successResponse(command, {
          agents,
          count: agents.length,
        });
      }

      case "agent.status": {
        const configured = !!acpClient || !!getDefaultAcpConfig().endpoint;

        return successResponse(command, {
          configured,
          acpClientInitialized,
          activeAgentCount: activeAgents.size,
        });
      }

      default:
        return errorResponse(command, "UNKNOWN_A2A_METHOD", `unknown a2a method: ${method}`);
    }
  };
}
