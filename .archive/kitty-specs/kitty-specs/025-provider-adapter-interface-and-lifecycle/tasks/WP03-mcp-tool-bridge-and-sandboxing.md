---
work_package_id: WP03
title: MCP Tool Bridge and Sandboxing
lane: "done"
dependencies:
- WP01
base_branch: 025-provider-adapter-interface-and-lifecycle-WP01
base_commit: 081484ebd513e9ed30cf48638b7f53e3d8115bee
created_at: '2026-03-01T13:34:37.457684+00:00'
subtasks:
- T011
- T012
- T013
- T014
- T015
phase: Phase 1 - Core Providers
assignee: ''
agent: "claude-haiku"
shell_pid: "76417"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 - MCP Tool Bridge and Sandboxing

## Objectives & Success Criteria

- Implement the MCP tool bridge adapter for tool discovery, schema registration, sandboxed invocation, and result capture.
- Wire MCP tool results to the local bus with correlation ID propagation.
- Handle MCP server disconnection gracefully with retryable error normalization and exponential backoff reconnection.
- Deliver sandboxed execution that isolates tool invocations in child processes with resource limits.

Success criteria:
- MCP bridge connects to a mock MCP server, discovers tools, and registers schemas.
- Tool invocation runs in a sandboxed child process with captured results and correlation ID.
- Server disconnection produces retryable error and triggers reconnection with backoff.
- Tool crash in sandbox does not affect host process or other tools.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/spec.md`
- WP01 outputs:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/registry.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/errors.ts`
- Protocol bus:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`

Constraints:
- TypeScript + Bun runtime.
- Sandboxed execution via child processes with resource limits (not in-process).
- Adapter overhead < 10ms (p95) excluding tool processing time.
- Reconnection uses exponential backoff with configurable max retries.
- Coverage >=85% with FR-025-004 traceability.

Implementation command:
- `spec-kitty implement WP03`

## Subtasks & Detailed Guidance

### Subtask T011 - Implement MCP bridge adapter with tool discovery and schema registration

- Purpose: Connect to MCP servers, discover available tools, and register their schemas for agent use.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`.
  2. Implement `MCPBridgeAdapter` class implementing `ProviderAdapter<MCPConfig, MCPToolInvocation, MCPToolResult>`.
  3. Define `MCPConfig` type: `endpoint: string`, `transport: 'stdio' | 'sse'`, `timeoutMs: number`, `maxRetries: number`, `reconnectBackoffMs: number`.
  4. Define `MCPToolInvocation` type: `toolName: string`, `arguments: Record<string, unknown>`, `timeout?: number`.
  5. Define `MCPToolResult` type: `toolName: string`, `result: unknown`, `duration: number`, `correlationId: string`.
  6. Implement `init(config: MCPConfig)`:
     - Establish connection to MCP server (stdio or SSE transport).
     - Perform protocol version negotiation; reject incompatible servers with `PROVIDER_INIT_FAILED`.
     - Call MCP `tools/list` to discover available tools.
     - Register each tool's name, description, and input/output schema in an internal tool catalog.
     - Publish `provider.mcp.tools.discovered` bus event with tool count and names.
  7. Implement tool catalog:
     - In-memory map of tool name -> `{ description, inputSchema, outputSchema }`.
     - `getToolSchema(name: string)` for downstream validation.
     - `listTools()` for catalog enumeration.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`
- Validation:
  - Bridge connects to mock MCP server and discovers tools.
  - Tool schemas are registered and queryable.
  - Incompatible server version is rejected with clear error.
  - Bus event emitted on tool discovery.
- Parallel: No.

### Subtask T012 - Implement sandboxed tool invocation with execution boundary enforcement

- Purpose: Execute MCP tool invocations in isolated child processes with resource limits.
- Steps:
  1. In `mcp-bridge.ts`, implement `execute(input: MCPToolInvocation, correlationId: string)`:
     - Validate tool name exists in catalog; reject unknown tools with normalized error.
     - Validate input arguments against tool's input schema; reject invalid inputs.
     - Spawn sandbox child process for tool invocation:
       - Use Bun `spawn` with resource limits (memory limit via `--max-old-space-size`, timeout via signal).
       - Pass tool invocation payload via IPC.
       - Capture stdout/stderr for debugging.
     - Wait for child process result or timeout.
     - On success: parse result, validate against output schema if available, return `MCPToolResult`.
     - On timeout: kill child process, throw `PROVIDER_TIMEOUT`.
     - On crash: throw `PROVIDER_CRASHED` with captured stderr.
  2. Implement resource limit configuration:
     - `maxMemoryMb: number` (default 256).
     - `maxExecutionMs: number` (default 30000).
     - Configurable per tool via tool-specific overrides in `MCPConfig`.
  3. Ensure child process cleanup:
     - Kill child on timeout or parent terminate.
     - Wait for exit to avoid zombie processes.
     - Close IPC channels.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`
- Validation:
  - Tool invocation runs in child process, not in host process.
  - Timeout kills child process and returns normalized error.
  - Crash in child does not affect host or other tool invocations.
  - No zombie processes after cleanup.
- Parallel: No.

### Subtask T013 - Wire MCP tool results to local bus with correlation ID propagation

- Purpose: Ensure MCP tool results are visible on the local bus with full traceability.
- Steps:
  1. After successful tool invocation, publish result to bus:
     - Topic: `provider.mcp.tool.completed`
     - Payload: correlation ID, tool name, result summary (truncated if large), duration.
  2. On invocation failure, publish failure event:
     - Topic: `provider.mcp.tool.failed`
     - Payload: correlation ID, tool name, error code, retryable flag, error message.
  3. On tool discovery refresh (reconnect scenario), publish updated catalog:
     - Topic: `provider.mcp.tools.refreshed`
     - Payload: added tools, removed tools, unchanged count.
  4. Ensure all bus events carry the originating correlation ID.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`
- Validation:
  - Bus events emitted for every tool invocation outcome.
  - Correlation IDs match between invocation input and bus event.
  - Tool discovery refresh events accurately reflect catalog changes.
- Parallel: No.

### Subtask T014 - Handle MCP server disconnection with reconnection strategy

- Purpose: Gracefully handle MCP server disconnection without crashing and re-establish connection.
- Steps:
  1. In `mcp-bridge.ts`, implement disconnection detection:
     - Monitor connection health via MCP protocol keepalive or transport-level signals.
     - On disconnection, transition health state to `degraded`.
     - Publish `provider.mcp.disconnected` bus event.
  2. Implement reconnection with exponential backoff:
     - Initial delay: `reconnectBackoffMs` from config (default 1000ms).
     - Backoff multiplier: 2x per attempt.
     - Max delay: 30000ms.
     - Max retries: configurable (default 10).
     - On successful reconnect: re-discover tools, publish `provider.mcp.reconnected` event, transition to `healthy`.
     - On max retries exceeded: transition to `unavailable`, publish `provider.mcp.reconnect.exhausted`.
  3. During disconnection, tool invocations return retryable `PROVIDER_UNAVAILABLE` error.
  4. Implement `terminate()`:
     - Cancel reconnection attempts.
     - Close MCP connection.
     - Clean up all sandbox child processes.
     - Release tool catalog.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`
- Validation:
  - Disconnection is detected and health transitions to degraded.
  - Reconnection uses exponential backoff with correct timing.
  - After max retries, state is unavailable.
  - Tool invocations during disconnection return retryable error.
  - Reconnection refreshes tool catalog.
  - Terminate cancels reconnection and cleans up.
- Parallel: No.

### Subtask T015 - Add integration tests for MCP tool lifecycle

- Purpose: Verify complete MCP lifecycle including connect, discover, invoke, disconnect, reconnect.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/mcp-bridge.test.ts`.
  2. Implement mock MCP server:
     - Configurable tool list with schemas.
     - Configurable invocation behavior (success, error, timeout, crash).
     - Ability to simulate disconnection and reconnection.
  3. Test scenarios:
     - **Connect and discover**: connect to mock, discover 3 tools, verify catalog.
     - **Version mismatch**: mock returns incompatible version -> `PROVIDER_INIT_FAILED`.
     - **Tool invocation success**: invoke tool, verify sandboxed execution and result with correlation ID.
     - **Tool invocation timeout**: mock delays beyond timeout -> `PROVIDER_TIMEOUT`, child killed.
     - **Tool invocation crash**: mock crashes sandbox -> `PROVIDER_CRASHED`, no host impact.
     - **Unknown tool**: invoke non-existent tool -> normalized error.
     - **Invalid input**: invoke with bad arguments -> validation error.
     - **Disconnection detection**: kill mock -> health transitions to degraded.
     - **Reconnection success**: restart mock -> bridge reconnects, catalog refreshed.
     - **Reconnection exhausted**: mock stays down -> max retries, state unavailable.
     - **Bus event verification**: verify all events emitted with correct correlation IDs.
     - **Terminate cleanup**: verify no orphan processes or connections.
  4. Map tests to requirements:
     - FR-025-004 (MCP integration): all MCP-specific tests.
     - FR-025-007 (process isolation): sandbox crash test.
     - FR-025-009 (health checks): disconnection/reconnection tests.
     - FR-025-011 (error normalization): all error scenario tests.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/mcp-bridge.test.ts`
- Validation:
  - All test scenarios pass.
  - Coverage >=85% on mcp-bridge.ts.
  - Each mapped FR has at least one test.
- Parallel: Yes (after T011/T012 are stable).

## Test Strategy

- Mock MCP server provides configurable behavior for all test scenarios.
- Sandbox tests use real child processes with mock tool logic.
- Reconnection tests use mock server restart to simulate recovery.
- Bus events captured via test spy for correlation verification.

## Risks & Mitigations

- Risk: MCP protocol version drift breaks adapter.
- Mitigation: Version negotiation on connect; all tests use mock server with pinned version.
- Risk: Sandbox child process overhead exceeds budget.
- Mitigation: Benchmark spawn/IPC in tests; consider process pooling if latency exceeds 10ms.

## Review Guidance

- Confirm tool discovery registers complete schemas (input + output).
- Confirm sandbox invocation runs in child process with resource limits.
- Confirm disconnection detection and reconnection backoff are deterministic.
- Confirm no zombie processes after any failure scenario.
- Confirm all bus events carry correct correlation IDs.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:34:37Z – claude-haiku – shell_pid=76417 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:35:41Z – claude-haiku – shell_pid=76417 – lane=done – Implemented: MCP bridge with tool discovery and sandboxing
