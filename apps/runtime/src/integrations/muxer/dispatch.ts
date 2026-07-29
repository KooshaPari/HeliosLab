import type { LocalBusEnvelope } from "../../protocol/types";

type MuxerSession = {
  id: string;
  type: string;
  status: "active" | "attached" | "detached" | "terminated";
  createdAt: number;
};

const sessions = new Map<string, MuxerSession>();
let nextId = 0;

export async function handleMuxerCommand(
  envelope: LocalBusEnvelope
): Promise<Record<string, unknown>> {
  const method = envelope.method ?? "";
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;

  switch (method) {
    case "muxer.list":
      return {
        sessions: Array.from(sessions.values()),
        available_types: ["zellij", "tmate", "upterm"],
      };

    case "muxer.spawn": {
      const type = (payload.type as string) ?? "zellij";
      const id = `mux-${++nextId}`;
      const session: MuxerSession = {
        id,
        type,
        status: "active",
        createdAt: Date.now(),
      };
      sessions.set(id, session);
      // TODO: Wire to real adapter when CLIs are available
      return { session_id: id, type, status: "active" };
    }

    case "muxer.attach": {
      const sessionId = payload.session_id as string;
      const session = sessions.get(sessionId);
      if (!session) return { error: `Session ${sessionId} not found` };
      session.status = "attached";
      return { session_id: sessionId, status: "attached" };
    }

    case "muxer.detach": {
      const sessionId = payload.session_id as string;
      const session = sessions.get(sessionId);
      if (!session) return { error: `Session ${sessionId} not found` };
      session.status = "detached";
      return { session_id: sessionId, status: "detached" };
    }

    case "muxer.kill": {
      const sessionId = payload.session_id as string;
      sessions.delete(sessionId);
      return { session_id: sessionId, status: "terminated" };
    }

    default:
      return { error: `Unknown muxer method: ${method}` };
  }
}
