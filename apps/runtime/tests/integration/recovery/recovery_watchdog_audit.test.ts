import { describe, expect, test } from "bun:test";
import { createRuntime } from "../../../src/index";

// Traces to: FR-CRH-001 (detect abnormal termination), FR-CRH-002 (recovery state machine),
// FR-CRH-006 (run orphan reconciliation), FR-CRH-007 (display recovery banner)

describe("WP05 recovery watchdog and audit fidelity", () => {
  test("reattaches recoverable sessions on restart and flags unrecoverable artifacts", async () => {
    const runtimeA = createRuntime();

    await runtimeA.bus.request({
      id: "cmd-lane-create",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-1",
      correlation_id: "corr-lane-create",
      method: "lane.create",
      payload: { id: "lane-1" },
    });
    await runtimeA.bus.request({
      id: "cmd-session-attach",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "session-1",
      correlation_id: "corr-session-attach",
      method: "session.attach",
      payload: {
        id: "session-1",
        lane_id: "lane-1",
        codex_session_id: "codex-1",
      },
    });
    await runtimeA.bus.request({
      id: "cmd-terminal-spawn",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-1",
      lane_id: "lane-1",
      session_id: "session-1",
      correlation_id: "corr-terminal-spawn",
      method: "terminal.spawn",
      payload: {
        id: "terminal-1",
        lane_id: "lane-1",
        session_id: "session-1",
      },
    });

    const _checkpoint = runtimeA.exportRecoveryMetadata();
    const runtimeB = createRuntime({ recovery_metadata: checkpoint });
    const bootstrap = runtimeB.getBootstrapResult();

    expect(bootstrap).not.toBeNull();
    expect(bootstrap?.recovered_session_ids).toContain("session-1");
    expect(bootstrap?.issues.length).toBe(0);

    const unrecoverableCheckpoint = {
      ...checkpoint,
      sessions: [
        ...(checkpoint.sessions as Array<Record<string, unknown>>),
        {
          session_id: "session-orphan",
          workspace_id: "ws-1",
          lane_id: "lane-1",
          status: "detached" as const,
        },
      ],
    };
    const runtimeC = createRuntime({
      recovery_metadata: unrecoverableCheckpoint,
    });
    const brokenBootstrap = runtimeC.getBootstrapResult();

    expect(
      brokenBootstrap?.issues.some(
        (issue: { state: string; remediation?: string; [key: string]: unknown }) =>
          issue.state === "unrecoverable"
      )
    ).toBe(true);

    runtimeA.shutdown();
    runtimeB.shutdown();
    runtimeC.shutdown();
  });

  test("watchdog classifies drift and exposes remediation-safe guidance", async () => {
    const runtime = createRuntime();
    runtime.bootstrapRecovery({
      lanes: [
        {
          lane_id: "lane-drift",
          workspace_id: "ws-2",
          session_id: "missing-session",
        },
      ],
      sessions: [
        {
          session_id: "session-drift",
          workspace_id: "ws-2",
          status: "detached",
          codex_session_id: "c2",
        },
      ],
      terminals: [
        {
          terminal_id: "terminal-drift",
          workspace_id: "ws-2",
          status: "active",
          session_id: "missing-session",
        },
      ],
    });

    const report = runtime.getOrphanReport();
    const recoverable = report.issues.filter(
      (issue: { state: string; remediation?: string; [key: string]: unknown }) =>
        issue.state === "recoverable"
    );
    const unrecoverable = report.issues.filter(
      (issue: { state: string; remediation?: string; [key: string]: unknown }) =>
        issue.state === "unrecoverable"
    );

    expect(report.issues.length).toBeGreaterThan(0);
    expect(recoverable.length).toBeGreaterThan(0);
    expect(unrecoverable.length).toBeGreaterThan(0);
    expect(
      report.issues.some(
        (issue: { state: string; remediation?: string; [key: string]: unknown }) =>
          issue.remediation === "cleanup"
      )
    ).toBe(true);
    expect(
      report.issues.some(
        (issue: { state: string; remediation?: string; [key: string]: unknown }) =>
          issue.remediation === "reconcile"
      )
    ).toBe(true);

    runtime.shutdown();
  });

  test("normalizes boundary failures and exports redacted correlated audit bundles", async () => {
    const runtime = createRuntime();

    await runtime.bus.request({
      id: "cmd-lane-create-ws3",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-3",
      correlation_id: "corr-ok",
      method: "lane.create",
      payload: { id: "lane-3" },
    });

    const failure = await runtime.bus.request({
      id: "cmd-session-attach-fail",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-3",
      lane_id: "lane-3",
      session_id: "session-3",
      correlation_id: "corr-harness",
      method: "session.attach",
      payload: {
        id: "session-3",
        lane_id: "lane-3",
        boundary_failure: "harness",
        api_key: "super-secret-value",
      },
    });

    expect(failure.status).toBe("error");
    expect(failure.error?.code).toBe("HARNESS_UNAVAILABLE");

    const unknown = await runtime.bus.request({
      id: "cmd-unknown-method",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-3",
      correlation_id: "corr-unknown",
      method: "harness.do.thing",
      payload: {},
    });
    expect(unknown.status).toBe("error");
    expect(unknown.error?.code).toBe("METHOD_NOT_SUPPORTED");

    const stillHealthy = await runtime.bus.request({
      id: "cmd-lane-create-ws3b",
      type: "command",
      ts: new Date().toISOString(),
      workspace_id: "ws-3",
      correlation_id: "corr-after-failure",
      method: "lane.create",
      payload: { id: "lane-4" },
    });
    expect(stillHealthy.status).toBe("ok");

    const auditBundle = runtime.exportAuditBundle({
      correlation_id: "corr-harness",
    });
    expect(auditBundle.count).toBeGreaterThan(0);
    const redactedRecord = auditBundle.records.find(
      (record: { type?: string; payload?: Record<string, unknown>; [key: string]: unknown }) =>
        record.type === "command"
    );
    expect(redactedRecord?.payload?.api_key).toBe("[REDACTED]");

    const allRecords = await runtime.getAuditRecords();
    for (let i = 1; i < allRecords.length; i += 1) {
      expect(
        (allRecords[i]?.recorded_at as string) >= (allRecords[i - 1]?.recorded_at as string)
      ).toBe(true);
    }

    runtime.shutdown();
  });
});
