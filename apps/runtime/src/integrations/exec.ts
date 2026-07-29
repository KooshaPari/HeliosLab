import type { LocalBus } from "../protocol/bus";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type SessionTransport = "cliproxy_harness" | "native_openai";

export type HarnessStatus = {
  status: "healthy" | "degraded" | "unavailable";
  fallback_transport: "native_openai";
  degrade_reason: string | null;
};

export type HarnessRouteDecision = {
  transport: SessionTransport;
  diagnostics: {
    selected_transport: SessionTransport;
    degrade_reason: string | null;
    harness_status: HarnessStatus["status"];
  };
};

export interface HarnessProbe {
  check(): Promise<{ ok: boolean; reason?: string | null }>;
}

export class ExecHarnessProbe implements HarnessProbe {
  async check(): Promise<{ ok: boolean; reason?: string | null }> {
    const result = await execCommand("cliproxyapi-plus", ["--healthcheck"]);
    if (result.code === 0) {
      return { ok: true };
    }

    const reason = result.stderr.trim() || result.stdout.trim() || "cliproxy_harness_unavailable";
    return { ok: false, reason };
  }
}

export class HarnessRouteSelector {
  private status: HarnessStatus = {
    status: "unavailable",
    fallback_transport: "native_openai",
    degrade_reason: "harness_not_checked",
  };

  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bus: LocalBus,
    private readonly probe: HarnessProbe = new ExecHarnessProbe(),
    private readonly cooldownMs = 1_000
  ) {}

  getStatus(): HarnessStatus {
    return { ...this.status };
  }

  async refreshHealth(source: "on_demand" | "interval" = "on_demand"): Promise<HarnessStatus> {
    const previous = this.status;
    try {
      const probeResult = await this.probe.check();
      this.status = probeResult.ok
        ? {
            status: "healthy",
            fallback_transport: "native_openai",
            degrade_reason: null,
          }
        : {
            status: "unavailable",
            fallback_transport: "native_openai",
            degrade_reason: probeResult.reason ?? "cliproxy_healthcheck_failed",
          };
    } catch (error) {
      this.status = {
        status: "degraded",
        fallback_transport: "native_openai",
        degrade_reason: this.errorReason(error),
      };
    }

    if (
      this.status.status !== previous.status ||
      this.status.degrade_reason !== previous.degrade_reason
    ) {
      await this.emitStatusChange(previous, this.status, source);
    }

    return this.getStatus();
  }

  selectRoute(preferredTransport?: SessionTransport): HarnessRouteDecision {
    if (preferredTransport === "native_openai") {
      return {
        transport: "native_openai",
        diagnostics: {
          selected_transport: "native_openai",
          degrade_reason: "preferred_transport_native_openai",
          harness_status: this.status.status,
        },
      };
    }

    if (this.status.status === "healthy") {
      return {
        transport: "cliproxy_harness",
        diagnostics: {
          selected_transport: "cliproxy_harness",
          degrade_reason: null,
          harness_status: this.status.status,
        },
      };
    }

    return {
      transport: "native_openai",
      diagnostics: {
        selected_transport: "native_openai",
        degrade_reason: this.status.degrade_reason ?? "cliproxy_route_degraded",
        harness_status: this.status.status,
      },
    };
  }

  startMonitoring(intervalMs = 5_000): void {
    this.stopMonitoring();
    this.monitorTimer = setInterval(
      () => {
        void this.refreshHealth("interval");
      },
      Math.max(intervalMs, this.cooldownMs)
    );
  }

  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  private async emitStatusChange(
    previous: HarnessStatus,
    current: HarnessStatus,
    source: "on_demand" | "interval"
  ): Promise<void> {
    await this.bus.publish({
      id: `harness-status:${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "harness.status.changed",
      payload: {
        source,
        previous,
        current,
        degrade_reason: current.degrade_reason,
      },
    });
  }

  private errorReason(error: unknown): string {
    if (error instanceof Error) {
      return error.message || "cliproxy_probe_exception";
    }
    return "cliproxy_probe_exception";
  }
}

export async function execCommand(command: string, args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutBuf, stderrBuf, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);

  return {
    code,
    stdout: new TextDecoder().decode(stdoutBuf),
    stderr: new TextDecoder().decode(stderrBuf),
  };
}

type TerminalCommandContext = {
  command_id: string;
  correlation_id: string;
  workspace_id: string;
  lane_id: string;
  session_id: string;
  terminal_id?: string;
};

type SpawnTerminalInput = TerminalCommandContext & {
  title?: string;
};

type InputTerminalInput = TerminalCommandContext & {
  terminal_id: string;
  data: string;
};

type ResizeTerminalInput = TerminalCommandContext & {
  terminal_id: string;
  cols: number;
  rows: number;
};

function nowIsoString() {
  return new Date().toISOString();
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid ${field}`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid ${field}`);
  }
}

export function buildSpawnTerminalCommand(input: SpawnTerminalInput) {
  assertString(input.command_id, "command_id");
  assertString(input.correlation_id, "correlation_id");
  assertString(input.workspace_id, "workspace_id");
  assertString(input.lane_id, "lane_id");
  assertString(input.session_id, "session_id");

  return {
    id: input.command_id,
    correlation_id: input.correlation_id,
    type: "command" as const,
    ts: nowIsoString(),
    method: "terminal.spawn" as const,
    workspace_id: input.workspace_id,
    lane_id: input.lane_id,
    session_id: input.session_id,
    payload: {
      session_id: input.session_id,
      terminal_id: input.terminal_id,
      title: input.title,
    },
  };
}

export function buildInputTerminalCommand(input: InputTerminalInput) {
  assertString(input.command_id, "command_id");
  assertString(input.correlation_id, "correlation_id");
  assertString(input.workspace_id, "workspace_id");
  assertString(input.lane_id, "lane_id");
  assertString(input.session_id, "session_id");
  assertString(input.terminal_id, "terminal_id");
  assertNonEmptyString(input.data, "data");

  return {
    id: input.command_id,
    correlation_id: input.correlation_id,
    type: "command" as const,
    ts: nowIsoString(),
    method: "terminal.input" as const,
    workspace_id: input.workspace_id,
    lane_id: input.lane_id,
    session_id: input.session_id,
    terminal_id: input.terminal_id,
    payload: {
      terminal_id: input.terminal_id,
      session_id: input.session_id,
      data: input.data,
    },
  };
}

export function buildResizeTerminalCommand(input: ResizeTerminalInput) {
  assertString(input.command_id, "command_id");
  assertString(input.correlation_id, "correlation_id");
  assertString(input.workspace_id, "workspace_id");
  assertString(input.lane_id, "lane_id");
  assertString(input.session_id, "session_id");
  assertString(input.terminal_id, "terminal_id");
  if (input.cols < 1 || input.rows < 1) {
    throw new Error("invalid terminal dimensions");
  }

  return {
    id: input.command_id,
    correlation_id: input.correlation_id,
    type: "command" as const,
    ts: nowIsoString(),
    method: "terminal.resize" as const,
    workspace_id: input.workspace_id,
    lane_id: input.lane_id,
    session_id: input.session_id,
    terminal_id: input.terminal_id,
    payload: {
      terminal_id: input.terminal_id,
      session_id: input.session_id,
      cols: input.cols,
      rows: input.rows,
    },
  };
}
