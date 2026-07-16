/**
 * Approval Queue Unit Tests (FR-APR-005, FR-APR-006)
 * Exercises the current in-memory request and resolution primitives.
 */
import { describe, expect, test } from "bun:test";
import { ApprovalQueue, ApprovalStatus } from "../../../src/policy/approval-queue";

describe("ApprovalQueue", () => {
  test("creates approval requests", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    expect(request.id).toBeTruthy();
    expect(request.command).toBe("git push");
    expect(request.status).toBe(ApprovalStatus.Pending);
  });

  test("approves requests with an operator-supplied reason (FR-APR-005)", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    queue.approve(request.id, "reviewer1", "Reviewed the command and affected files");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Approved);
    expect(updated?.approvedBy).toBe("reviewer1");
    expect(updated?.approvedReason).toBe("Reviewed the command and affected files");
  });

  test("rejects requests with an operator-supplied reason (FR-APR-005)", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    queue.reject(request.id, "Dangerous operation");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Rejected);
    expect(updated?.rejectedReason).toBe("Dangerous operation");
  });

  test("requires a non-blank operator reason for either resolution (FR-APR-005)", () => {
    const queue = new ApprovalQueue();
    const approval = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");
    const rejection = queue.createRequest("rm artifact", "workspace1", "agent1", "Test Agent");

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
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent", 10);

    await new Promise(resolve => setTimeout(resolve, 25));

    expect(queue.getRequest(request.id)?.status).toBe(ApprovalStatus.Expired);
    expect(queue.getRequest(request.id)?.rejectedReason).toBe(
      "Approval request timed out; default action: deny"
    );
  });

  test("does not allow an expired request to be approved (FR-APR-006)", async () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent", 10);

    await new Promise(resolve => setTimeout(resolve, 25));

    expect(() => queue.approve(request.id, "reviewer1", "Approve after timeout")).toThrow(
      "Only pending approval requests can be resolved"
    );
    expect(queue.getRequest(request.id)?.status).toBe(ApprovalStatus.Expired);
  });

  test("rejects invalid timeout configuration (FR-APR-006)", () => {
    const queue = new ApprovalQueue();

    for (const timeout of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        queue.createRequest("git push", "workspace1", "agent1", "Test Agent", timeout)
      ).toThrow("Approval request timeout must be a positive finite number");
    }
  });

  test("filters pending requests", () => {
    const queue = new ApprovalQueue();
    queue.createRequest("cmd1", "ws1", "ag1", "User1");
    const req2 = queue.createRequest("cmd2", "ws1", "ag1", "User1");
    queue.approve(req2.id, "reviewer", "Expected command");

    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].command).toBe("cmd1");
  });

  test("filters by workspace", () => {
    const queue = new ApprovalQueue();
    queue.createRequest("cmd1", "ws1", "ag1", "User1");
    queue.createRequest("cmd2", "ws2", "ag1", "User1");

    const ws1 = queue.getForWorkspace("ws1");
    expect(ws1.length).toBe(1);
  });
});
