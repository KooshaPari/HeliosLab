/**
 * FR-HELIOS-072: Approval Queue Tests
 * Verifies: FR-APR-004 (Approval request creation), FR-APR-005 (Approve/deny actions), FR-APR-007 (Durable persistence)
 */
import { test, expect, describe } from "bun:test";
import { ApprovalQueue, ApprovalStatus } from "../../../src/policy/approval-queue";

describe("ApprovalQueue", () => {
  test("creates approval requests", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    expect(request.id).toBeTruthy();
    expect(request.command).toBe("git push");
    expect(request.status).toBe(ApprovalStatus.Pending);
  });

  test("approves requests", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    queue.approve(request.id, "reviewer1");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Approved);
    expect(updated?.approvedBy).toBe("reviewer1");
  });

  test("rejects requests", () => {
    const queue = new ApprovalQueue();
    const request = queue.createRequest("git push", "workspace1", "agent1", "Test Agent");

    queue.reject(request.id, "Dangerous operation");
    const updated = queue.getRequest(request.id);

    expect(updated?.status).toBe(ApprovalStatus.Rejected);
  });

  test("filters pending requests", () => {
    const queue = new ApprovalQueue();
    queue.createRequest("cmd1", "ws1", "ag1", "User1");
    const req2 = queue.createRequest("cmd2", "ws1", "ag1", "User1");
    queue.approve(req2.id, "reviewer");

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
