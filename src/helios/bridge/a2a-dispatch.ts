/**
 * Agent Delegation Boundary Dispatcher
 *
 * Routes agent_delegation commands to local agents.
 * Spawns real agent subprocesses via Bun.spawn().
 * Supports: agent.run, agent.cancel, agent.list
 */

import type { LocalBusEnvelope } from "../runtime/protocol/types";

interface AgentProcess {
  id: string;
  proc: ReturnType<typeof Bun.spawn>;
  stdout: string;
  stderr: string;
  status: "running" | "completed" | "cancelled" | "errored";
}

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

const activeAgents = new Map<string, AgentProcess>();

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
          const proc_command = (payload?.command as string) || "claude";
          const args = (payload?.args as string[]) || [];
          const input = (payload?.input as string) || "";
          const cwd = (payload?.cwd as string) || process.cwd();

          // Spawn the subprocess
          const proc = Bun.spawn([proc_command, ...args], {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
          });

          const stdoutBuf: Uint8Array[] = [];
          const stderrBuf: Uint8Array[] = [];

          // Collect stdout
          if (proc.stdout) {
            for await (const chunk of proc.stdout) {
              stdoutBuf.push(chunk);
            }
          }

          // Collect stderr
          if (proc.stderr) {
            for await (const chunk of proc.stderr) {
              stderrBuf.push(chunk);
            }
          }

          // Send input if provided
          if (input && proc.stdin) {
            proc.stdin.write(input);
            proc.stdin.end();
          }

          // Wait for process to complete
          const exitCode = await proc.exited;

          const stdout = Buffer.concat(stdoutBuf).toString("utf-8");
          const stderr = Buffer.concat(stderrBuf).toString("utf-8");

          // Track in activeAgents
          activeAgents.set(agentId, {
            id: agentId,
            proc,
            stdout,
            stderr,
            status: exitCode === 0 ? "completed" : "errored",
          });

          return successResponse(command, {
            agentId,
            stdout,
            stderr,
            exitCode,
            status: exitCode === 0 ? "completed" : "errored",
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
          // Send SIGTERM
          agent.proc.kill("SIGTERM");

          // Wait 3 seconds for graceful shutdown
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // If still running, send SIGKILL
          if (!agent.proc.killed) {
            agent.proc.kill("SIGKILL");
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
          stdoutLength: agent.stdout.length,
          stderrLength: agent.stderr.length,
        }));

        return successResponse(command, {
          agents,
          count: agents.length,
        });
      }

      default:
        return errorResponse(command, "UNKNOWN_A2A_METHOD", `unknown a2a method: ${method}`);
    }
  };
}
