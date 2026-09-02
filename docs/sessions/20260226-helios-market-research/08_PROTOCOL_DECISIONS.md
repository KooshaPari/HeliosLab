# Protocol Decisions

Date: 2026-02-26
Status: Accepted

## Scope

Lock protocol usage and naming to avoid ACP ambiguity.

## Decision 1: ACP meaning in Helios

Helios uses `ACP` to mean **Agent Client Protocol** at the app-client boundary.

- Helios acts as the client/editor.
- ACP is used for client-to-agent runtime wiring where ACP-compatible adapters are available.

Helios does **not** use ACP as a replacement for internal runtime orchestration.

## Decision 2: Internal runtime control

Use `helios.localbus.v1` (internal local control bus) as source of truth for:
- session lifecycle
- terminal lifecycle
- renderer switching
- approvals and policy events
- audit correlation

## Decision 3: MCP usage

Use `MCP` for tool/resource interoperability only.

- MCP calls are initiated by runtime services.
- MCP events map into local bus audit and progress events.

## Decision 4: A2A usage

Use `A2A` only at external federation boundaries.

- no A2A dependency for local single-user execution
- external agent delegations must map back to local `agent.run.*` lifecycle

## Decision 5: AG-UI usage

Use AG-UI as optional frontend event contract adapter.

- local bus remains canonical
- AG-UI is projection/translation for UI composition

## Decision 6: Protocol precedence

When multiple transports/protocols overlap:
1. internal local bus semantics are authoritative
2. ACP/MCP/A2A/AG-UI adapters must preserve local event truth
3. adapters cannot mutate semantic meaning of command outcomes
