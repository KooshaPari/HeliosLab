/**
 * Approval Queue Unit Tests (FR-APR-004, FR-APR-005, FR-APR-006)
 * Exercises the current in-memory request and resolution primitives.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ApprovalRequestInput } from "../../../src/policy/approval-queue";
import { ApprovalQueue, ApprovalStatus } from "../../../src/policy/approval-queue";
import { ApprovalQueueStorage } from "../../../src/policy/storage";

const approvalInput = (overrides: Partial<ApprovalRequestInput> = {}): ApprovalRequestInput => ({
  command: "git push",
  workspaceId: "workspace1",
  agentId: "agent1",
  requesterName: "Test Agent",
  affectedFiles: ["src/policy.ts"],
  riskClassification: "needs-approval",
  agentRationale: "Publish the reviewed policy change",
  diffContext: "+ require explicit approval",
  ...overrides,
});

describe("ApprovalQueue", () => {
  test("creates requests with complete review context (FR-APR-004)", () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput());

    expect(request.affectedFiles).toEqual(["src/policy.ts"]);
    expect(request.riskClassification).toBe("needs-approval");
    expect(request.agentRationale).toBe("Publish the reviewed policy change");
    expect(request.diffContext).toBe("+ require explicit approval");
  });

  test("rejects incomplete or invalid review context (FR-APR-004)", () => {
    const queue = new ApprovalQueue({ storage: null });

    expect(() => queue.createRequest(approvalInput({ agentRationale: " " }))).toThrow(
      "Approval request agent rationale must not be blank"
    );
    expect(() => queue.createRequest(approvalInput({ diffContext: "" }))).toThrow(
      "Approval request diff context must not be blank"
    );
    expect(() =>
      queue.createRequest(approvalInput({ affectedFiles: ["src/file.ts", " "] }))
    ).toThrow("Approval request affected file must not be blank");
    expect(() =>
      queue.createRequest(
        approvalInput({
          riskClassification: "critical" as ApprovalRequestInput["riskClassification"],
        })
      )
    ).toThrow("Approval request has an invalid risk classification");
  });

  test("creates approval requests", () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput());

    expect(request.id).toBeTruthy();
    expect(request.command).toBe("git push");
    expect(request.status).toBe(ApprovalStatus.Pending);
  });

  test("approves requests with an operator-supplied reason (FR-APR-005)", () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput());

    queue.approve(request.id, "reviewer1", "Reviewed the command and affected files");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Approved);
    expect(updated?.approvedBy).toBe("reviewer1");
    expect(updated?.approvedReason).toBe("Reviewed the command and affected files");
  });

  test("rejects requests with an operator-supplied reason (FR-APR-005)", () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput());

    queue.reject(request.id, "Dangerous operation");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Rejected);
    expect(updated?.rejectedReason).toBe("Dangerous operation");
  });

  test("requires a non-blank operator reason for either resolution (FR-APR-005)", () => {
    const queue = new ApprovalQueue({ storage: null });
    const approval = queue.createRequest(approvalInput());
    const rejection = queue.createRequest(approvalInput({ command: "rm artifact" }));

    expect(() => queue.approve(approval.id, "reviewer1", "  ")).toThrow(
      "Approval resolution requires an operator-supplied reason"
    );
    expect(() => queue.reject(rejection.id, "")).toThrow(
      "Approval resolution requires an operator-supplied reason"
    );
    expect(queue.getRequest(approval.id)?.status).toBe(ApprovalStatus.Pending);
    expect(queue.getRequest(rejection.id)?.status).toBe(ApprovalStatus.Pending);
  });

  test("applies the default deny action when a configurable timeout elapses (FR-APR-006)", async () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput({ expiryMs: 10 }));

    await new Promise(resolve => setTimeout(resolve, 25));

    expect(queue.getRequest(request.id)?.status).toBe(ApprovalStatus.Expired);
    expect(queue.getRequest(request.id)?.rejectedReason).toBe(
      "Approval request timed out; default action: deny"
    );
  });

  test("does not allow an expired request to be approved (FR-APR-006)", async () => {
    const queue = new ApprovalQueue({ storage: null });
    const request = queue.createRequest(approvalInput({ expiryMs: 10 }));

    await new Promise(resolve => setTimeout(resolve, 25));

    expect(() => queue.approve(request.id, "reviewer1", "Approve after timeout")).toThrow(
      "Only pending approval requests can be resolved"
    );
    expect(queue.getRequest(request.id)?.status).toBe(ApprovalStatus.Expired);
  });

  test("rejects invalid timeout configuration (FR-APR-006)", () => {
    const queue = new ApprovalQueue({ storage: null });

    for (const timeout of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => queue.createRequest(approvalInput({ expiryMs: timeout }))).toThrow(
        "Approval request timeout must be a positive finite number"
      );
    }
  });

  test("filters pending requests", () => {
    const queue = new ApprovalQueue({ storage: null });
    queue.createRequest(
      approvalInput({ command: "cmd1", workspaceId: "ws1", agentId: "ag1", requesterName: "User1" })
    );
    const req2 = queue.createRequest(
      approvalInput({ command: "cmd2", workspaceId: "ws1", agentId: "ag1", requesterName: "User1" })
    );
    queue.approve(req2.id, "reviewer", "Expected command");

    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.command).toBe("cmd1");
  });

  test("filters by workspace", () => {
    const queue = new ApprovalQueue({ storage: null });
    queue.createRequest(approvalInput({ command: "cmd1", workspaceId: "ws1" }));
    queue.createRequest(approvalInput({ command: "cmd2", workspaceId: "ws2" }));

    const ws1 = queue.getForWorkspace("ws1");
    expect(ws1.length).toBe(1);
  });

  test("restores pending requests after restart (FR-APR-007)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "helios-approval-queue-"));
    const storagePath = join(dataDir, "approval-queue.json");

    try {
      const firstQueue = new ApprovalQueue({
        storage: new ApprovalQueueStorage(storagePath),
      });
      const pending = firstQueue.createRequest(approvalInput({ command: "deploy pending" }));
      const resolved = firstQueue.createRequest(approvalInput({ command: "deploy approved" }));
      firstQueue.approve(resolved.id, "reviewer", "Approved before restart");
      firstQueue.close();

      const restartedQueue = new ApprovalQueue({
        storage: new ApprovalQueueStorage(storagePath),
      });

      expect(restartedQueue.getPending()).toEqual([
        expect.objectContaining({ id: pending.id, command: "deploy pending" }),
      ]);
      expect(restartedQueue.getRequest(resolved.id)).toBeUndefined();
      restartedQueue.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
