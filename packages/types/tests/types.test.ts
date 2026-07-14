import { describe, it, expect } from "bun:test";
import type {
    Workspace,
    Session,
    Lane,
    Terminal,
    Checkpoint,
    CommandEnvelope,
    ResponseEnvelope,
    EventEnvelope,
} from "../src/index";

// Traces to: FR-BUS-001 (envelope schema), FR-ID-001 (ID format types)
describe("Workspace types", () => {
    it("should define Workspace interface correctly", () => {
        const workspace: Workspace = {
            id: "ws-1",
            name: "Test Workspace",
            rootPath: "/test/path",
            state: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        expect(workspace.id).toBe("ws-1");
        expect(workspace.state).toBe("active");
    });

    it("should allow all workspace states", () => {
        const states: Workspace["state"][] = ["active", "closed", "deleted"];
        expect(states).toContain("active");
        expect(states).toContain("closed");
        expect(states).toContain("deleted");
    });
});

describe("Session types", () => {
    it("should define Session interface correctly", () => {
        const session: Session = {
            id: "sess-1",
            laneId: "lane-1",
            terminalId: "term-1",
            workspaceId: "ws-1",
            createdAt: Date.now(),
            state: "active",
        };
        expect(session.id).toBe("sess-1");
        expect(session.state).toBe("active");
    });

    it("should allow all session states", () => {
        const states: Session["state"][] = ["active", "detached", "terminated"];
        expect(states).toContain("active");
    });
});

describe("Lane types", () => {
    it("should define Lane interface correctly", () => {
        const lane: Lane = {
            id: "lane-1",
            workspaceId: "ws-1",
            state: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        expect(lane.id).toBe("lane-1");
        expect(lane.state).toBe("active");
    });

    it("should allow all lane states", () => {
        const states: Lane["state"][] = ["creating", "active", "closed", "failed"];
        expect(states).toContain("creating");
        expect(states).toContain("active");
    });
});

describe("Terminal types", () => {
    it("should define Terminal interface correctly", () => {
        const terminal: Terminal = {
            id: "term-1",
            sessionId: "sess-1",
            state: "running",
            createdAt: Date.now(),
        };
        expect(terminal.id).toBe("term-1");
        expect(terminal.state).toBe("running");
    });

    it("should allow all terminal states", () => {
        const states: Terminal["state"][] = ["spawning", "running", "throttled", "closed"];
        expect(states).toContain("running");
        expect(states).toContain("throttled");
    });
});

describe("Envelope types", () => {
    it("should define CommandEnvelope correctly", () => {
        const cmd: CommandEnvelope = {
            id: "cmd-1",
            type: "command",
            ts: new Date().toISOString(),
            method: "lane.create",
            workspace_id: "ws-1",
            correlation_id: "cor-1",
            payload: { name: "test-lane" },
        };
        expect(cmd.type).toBe("command");
        expect(cmd.method).toBe("lane.create");
    });

    it("should define ResponseEnvelope correctly", () => {
        const res: ResponseEnvelope = {
            id: "res-1",
            type: "response",
            ts: new Date().toISOString(),
            status: "ok",
            method: "lane.create",
            result: { lane_id: "lane-1" },
        };
        expect(res.type).toBe("response");
        expect(res.status).toBe("ok");
        expect(res.result?.lane_id).toBe("lane-1");
    });

    it("should define error ResponseEnvelope correctly", () => {
        const res: ResponseEnvelope = {
            id: "res-2",
            type: "response",
            ts: new Date().toISOString(),
            status: "error",
            method: "lane.create",
            error: {
                code: "VALIDATION_ERROR",
                message: "Invalid lane name",
                retryable: true,
            },
        };
        expect(res.status).toBe("error");
        expect(res.error?.code).toBe("VALIDATION_ERROR");
        expect(res.error?.retryable).toBe(true);
    });

    it("should define EventEnvelope correctly", () => {
        const evt: EventEnvelope = {
            id: "evt-1",
            type: "event",
            ts: new Date().toISOString(),
            topic: "lane.created",
            lane_id: "lane-1",
            payload: { state: "active" },
        };
        expect(evt.type).toBe("event");
        expect(evt.topic).toBe("lane.created");
    });
});

describe("Checkpoint types", () => {
    it("should define Checkpoint interface correctly", () => {
        const checkpoint: Checkpoint = {
            version: 1,
            lanes: [
                {
                    sessionId: "sess-1",
                    terminalId: "term-1",
                    laneId: "lane-1",
                    workingDirectory: "/test",
                    environmentVariables: { HOME: "/Users/test" },
                    scrollbackSnapshot: "last command output",
                    zelijjSessionName: "main",
                    shellCommand: "/bin/zsh",
                },
            ],
            createdAt: new Date().toISOString(),
            metadata: { source: "test" },
        };
        expect(checkpoint.version).toBe(1);
        expect(checkpoint.lanes).toHaveLength(1);
        expect(checkpoint.metadata?.source).toBe("test");
    });
});
