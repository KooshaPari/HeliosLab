export type EnvelopeType = "command" | "response" | "event";

export type ErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown> | null;
};

export type LocalBusEnvelope = {
  id: string;
  type: EnvelopeType;
  ts: string;
  workspace_id?: string;
  session_id?: string;
  terminal_id?: string;
  method?: string;
  topic?: string;
  payload?: Record<string, unknown>;
  status?: "ok" | "error";
  result?: Record<string, unknown> | null;
  error?: ErrorPayload | null;
};
