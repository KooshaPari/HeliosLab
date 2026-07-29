# Protocol and Events

## Purpose

Define the implementation-ready protocol contract for HeliosApp runtime communication:
- internal local control bus (authoritative)
- AG-UI event mapping for frontend streaming UX
- MCP and A2A boundary usage

## 1) Protocol Boundaries

- Internal local control bus:
  - deterministic command and event orchestration inside Helios runtime
  - transport: local IPC (unix socket/named pipe)
  - message format: JSON-RPC style envelopes + typed event payloads

- AG-UI mapping layer:
  - frontend event contract for reactive UI updates
  - built from internal events (translation, not source of truth)

- MCP boundary:
  - tool/resource interoperability with tool servers

- A2A boundary:
  - external agent federation only

## 2) Internal Bus Envelope

### Command request

```json
{
  "id": "req_01J...",
  "type": "command",
  "method": "session.create",
  "ts": "2026-02-26T00:00:00.000Z",
  "actor": {
    "kind": "user",
    "id": "user_local"
  },
  "workspace_id": "ws_123",
  "payload": {
    "project_id": "proj_123",
    "profile_id": "profile_codex",
    "mode": "freehand"
  }
}
```

### Command response

```json
{
  "id": "req_01J...",
  "type": "response",
  "status": "ok",
  "ts": "2026-02-26T00:00:00.050Z",
  "result": {
    "session_id": "sess_123"
  },
  "error": null
}
```

### Event envelope

```json
{
  "id": "evt_01J...",
  "type": "event",
  "topic": "terminal.output",
  "ts": "2026-02-26T00:00:00.080Z",
  "workspace_id": "ws_123",
  "session_id": "sess_123",
  "terminal_id": "term_123",
  "payload": {}
}
```

## 3) Core Command Methods

- `workspace.create`
- `workspace.open`
- `project.clone`
- `project.init`
- `session.create`
- `session.attach`
- `session.terminate`
- `terminal.spawn`
- `terminal.resize`
- `terminal.input`
- `renderer.switch`
- `renderer.capabilities`
- `agent.run`
- `agent.cancel`
- `approval.request.resolve`
- `share.upterm.start`
- `share.upterm.stop`
- `share.tmate.start`
- `share.tmate.stop`
- `zmx.checkpoint`
- `zmx.restore`

## 4) Core Event Topics

- `workspace.opened`
- `project.ready`
- `session.created`
- `session.attached`
- `session.terminated`
- `terminal.spawned`
- `terminal.output`
- `terminal.state.changed`
- `renderer.switch.started`
- `renderer.switch.succeeded`
- `renderer.switch.failed`
- `agent.run.started`
- `agent.run.progress`
- `agent.run.completed`
- `agent.run.failed`
- `approval.requested`
- `approval.resolved`
- `share.session.started`
- `share.session.stopped`
- `audit.recorded`

## 5) Renderer Switch Contract

### Request

```json
{
  "method": "renderer.switch",
  "payload": {
    "target": "ghostty",
    "mode": "auto"
  }
}
```

### Semantics

- `mode=auto`:
  - attempt hot swap first
  - fallback to restart-and-restore when unsupported

- Required guarantees:
  - PTY process state must be preserved
  - either complete success or rollback to prior renderer
  - event emission order:
    1. `renderer.switch.started`
    2. `renderer.switch.succeeded` or `renderer.switch.failed`

## 6) AG-UI Mapping

Internal event to AG-UI translation examples:

- `terminal.output` -> `ui.stream.delta`
- `agent.run.progress` -> `ui.agent.progress`
- `approval.requested` -> `ui.approval.required`
- `approval.resolved` -> `ui.approval.result`
- `renderer.switch.started` -> `ui.system.notice`
- `renderer.switch.failed` -> `ui.error`

AG-UI mapping principle:
- internal bus remains canonical
- AG-UI adapter may aggregate/summarize but never mutate source event facts

## 7) MCP and A2A Usage Contract

### MCP

- invoked by internal runtime for tool operations
- all MCP calls produce audit events with:
  - tool name
  - args hash/redacted payload
  - duration
  - outcome

### A2A

- used for external multi-agent delegation
- never required for local single-user terminal orchestration
- external tasks must map back to internal `agent.run.*` lifecycle events

## 8) Errors and Retry Model

### Error envelope

```json
{
  "code": "RENDERER_SWITCH_UNSUPPORTED",
  "message": "Target renderer does not support hot swap",
  "retryable": true,
  "details": {
    "fallback": "restart"
  }
}
```

### Standard error codes

- `INVALID_REQUEST`
- `UNAUTHORIZED_ACTION`
- `POLICY_DENIED`
- `SESSION_NOT_FOUND`
- `TERMINAL_NOT_FOUND`
- `RENDERER_SWITCH_UNSUPPORTED`
- `RENDERER_SWITCH_FAILED`
- `SHARE_START_FAILED`
- `MCP_CALL_FAILED`
- `A2A_CALL_FAILED`

## 9) Security Controls in Protocol

- all command requests include `actor`, `workspace_id`, and policy context
- sensitive payload fragments are redacted at event sink boundary
- share-session start methods require explicit approval token
- policy engine runs before executing any `agent.run`, `share.*`, or destructive terminal action

## 10) Observability and Audit

Each command and high-value event must include:
- correlation id
- actor id
- workspace/session ids
- start/end timestamps
- result status
- policy decision id (if applicable)

Audit sink minimum outputs:
- append-only event log
- searchable command ledger
- export JSON bundle per session

## 11) Versioning

- protocol namespace: `helios.localbus.v1`
- AG-UI adapter namespace: `helios.agui.v1`
- backward-incompatible changes require `v2` namespace and migration notes
