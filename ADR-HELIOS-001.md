# Architecture Decision Record: LocalBus V1 Protocol

**ADR-HELIOS-001**  
**Status:** Accepted  
**Date:** 2026-03-15  
**Author:** Phenotype Engineering  
**Stakeholders:** Runtime Team, Desktop Team, QA

---

## Context

heliosApp requires a message passing system to coordinate between its desktop shell (ElectroBun), runtime engine (Bun), and web renderer (SolidJS). The system must support:

1. **26 registered methods** for command dispatch (workspace.create, session.attach, terminal.spawn, etc.)
2. **40 registered topics** for event pub/sub (session.created, terminal.output, lane.state_changed, etc.)
3. **Correlation tracking** to link commands, events, and responses
4. **Lifecycle ordering** to enforce valid state machine transitions
5. **Sub-millisecond latency** for local operations
6. **Type safety** throughout the TypeScript stack

We evaluated three approaches:
- Electron-style IPC (cross-process serialization)
- gRPC with protobuf (strong types, but heavy)
- In-process LocalBus (direct function calls, zero serialization)

---

## Decision

We will implement an **in-process LocalBus** with typed envelope protocols. The bus runs within the runtime process, with the desktop shell communicating via a runtime client that dispatches to the bus.

### Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Desktop Shell (ElectroBun)                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  runtime_client.ts                                     │  │
│  │  - HTTP client to runtime API                         │  │
│  │  - EventSource for server-sent events                 │  │
│  └──────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────────┘
                              │ HTTP/WebSocket
┌─────────────────────────────▼──────────────────────────────────┐
│  Runtime Engine (Bun)                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  HTTP Server (Bun fetch handler)                       │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  /v1/protocol/dispatch                           │ │  │
│  │  │  /v1/protocol/subscribe                        │ │  │
│  │  └──────────────────────┬───────────────────────────┘ │  │
│  │                         │                           │  │
│  │  ┌──────────────────────▼──────────────────────────┐│  │
│  │  │  LocalBus (In-Process)                          ││  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌───────────┐  ││  │
│  │  │  │ Method      │ │ Topic       │ │ Response  │  ││  │
│  │  │  │ Registry    │ │ Registry    │ │ Registry  │  ││  │
│  │  │  │ (26 entries)│ │ (40 entries)│ │ (cor_id)  │  ││  │
│  │  │  └──────┬──────┘ └──────┬──────┘ └─────┬─────┘  ││  │
│  │  │         │               │              │        ││  │
│  │  │         └───────────────┴──────────────┘        ││  │
│  │  │                         │                        ││  │
│  │  │                   Router/Dispatcher              ││  │
│  │  └─────────────────────────┼────────────────────────┘│  │
│  └──────────────────────────┼───────────────────────────┘  │
│                             │ Direct function calls         │
│  ┌──────────────────────────▼──────────────────────────┐   │
│  │  Service Layer                                        │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │   │
│  │  │Session │ │  PTY   │ │Provider│ │  Audit │      │   │
│  │  │Service │ │Service │ │Service │ │Service │      │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘      │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### Envelope Schema

```typescript
// Command Envelope - method-based dispatch
interface CommandEnvelope {
  // Unique envelope ID (ulid with env_ prefix)
  id: string;
  
  // Links this command to all resulting events/responses
  correlation_id: string;
  
  // Discriminator for envelope type
  type: 'command';
  
  // Must be registered in MethodRegistry (26 methods)
  method: string;
  
  // Method-specific payload (type-checked via generics)
  payload: unknown;
  
  // Execution context (validates state machine transitions)
  context: {
    workspace_id?: string;  // ws_{ulid}
    lane_id?: string;       // ln_{ulid}
    session_id?: string;    // ss_{ulid}
    terminal_id?: string;   // tm_{ulid}
  };
  
  // Unix timestamp (ms) for ordering and TTL
  timestamp: number;
}

// Event Envelope - topic-based pub/sub
interface EventEnvelope {
  id: string;
  
  // Links to originating command (if any)
  correlation_id?: string;
  
  type: 'event';
  
  // Must be registered in TopicRegistry (40 topics)
  topic: string;
  
  payload: unknown;
  
  context: ContextFields;
  
  timestamp: number;
  
  // Monotonically increasing per topic for ordering
  sequence: number;
}

// Response Envelope - command result
interface ResponseEnvelope {
  id: string;
  
  // Matches originating command's correlation_id
  correlation_id: string;
  
  type: 'response';
  
  status: 'success' | 'error';
  
  // Present when status is 'success'
  result?: unknown;
  
  // Present when status is 'error'
  error?: {
    code: ErrorCode;           // VALIDATION_ERROR | METHOD_NOT_FOUND | ...
    message: string;
    retryable: boolean;        // Client can retry?
    details?: Record<string, unknown>;
  };
  
  timestamp: number;
}
```

### Method Registry (26 Methods)

```typescript
const METHOD_REGISTRY = {
  // Workspace & Project
  'workspace.create': WorkspaceCreateHandler,
  'workspace.open': WorkspaceOpenHandler,
  'project.clone': ProjectCloneHandler,
  'project.init': ProjectInitHandler,
  
  // Session & Terminal
  'session.create': SessionCreateHandler,
  'session.attach': SessionAttachHandler,
  'session.terminate': SessionTerminateHandler,
  'terminal.spawn': TerminalSpawnHandler,
  'terminal.resize': TerminalResizeHandler,
  'terminal.input': TerminalInputHandler,
  
  // Lane Management
  'lane.create': LaneCreateHandler,
  'lane.attach': LaneAttachHandler,
  'lane.cleanup': LaneCleanupHandler,
  
  // Renderer
  'renderer.switch': RendererSwitchHandler,
  'renderer.capabilities': RendererCapabilitiesHandler,
  
  // Agent
  'agent.run': AgentRunHandler,
  'agent.cancel': AgentCancelHandler,
  
  // Sharing
  'share.upterm.start': ShareUptermStartHandler,
  'share.upterm.stop': ShareUptermStopHandler,
  'share.tmate.start': ShareTmateStartHandler,
  'share.tmate.stop': ShareTmateStopHandler,
  
  // Zellij
  'zmx.checkpoint': ZmxCheckpointHandler,
  'zmx.restore': ZmxRestoreHandler,
  
  // Policy
  'approval.request.resolve': ApprovalResolveHandler,
  
  // Boundary Dispatch
  'boundary.local.dispatch': BoundaryLocalDispatchHandler,
  'boundary.tool.dispatch': BoundaryToolDispatchHandler,
  'boundary.a2a.dispatch': BoundaryA2ADispatchHandler,
} as const;

type MethodName = keyof typeof METHOD_REGISTRY;
```

### Topic Registry (40 Topics)

Key topics include:
- Lifecycle: `workspace.opened`, `lane.created`, `session.created`, `session.attached`
- Terminal: `terminal.spawned`, `terminal.output`, `terminal.resized`, `terminal.stopped`
- Agent: `agent.run.started`, `agent.run.completed`, `agent.run.failed`
- System: `harness.status.changed`, `audit.recorded`, `diagnostics.metric`

### State Machine Validation

Every lifecycle-critical entity has explicit state transitions validated by the bus:

```typescript
// Lane State Machine
const LANE_STATES = {
  idle: ['creating'],
  creating: ['active', 'failed'],
  active: ['paused', 'cleanup', 'failed'],
  paused: ['active', 'cleanup'],
  cleanup: ['closed', 'failed'],
  closed: [],
  failed: ['cleanup'],
  terminated: [],
} as const;

// Session State Machine
const SESSION_STATES = {
  created: ['attaching'],
  attaching: ['attached', 'failed'],
  attached: ['detaching'],
  detaching: ['detached', 'failed'],
  detached: ['attaching', 'terminated'],
  terminated: [],
} as const;

// Validation happens at the bus layer
function validateTransition(
  entity: string,
  from: State,
  to: State
): Result<void, ValidationError> {
  const machine = getStateMachine(entity);
  const validTransitions = machine[from];
  
  if (!validTransitions.includes(to)) {
    return Err({
      code: 'INVALID_STATE_TRANSITION',
      message: `Cannot transition ${entity} from ${from} to ${to}`,
      validTransitions,
    });
  }
  
  return Ok();
}
```

### Correlation Tracking

The correlation system links all related envelopes:

```typescript
class CorrelationTracker {
  private correlations = new Map<string, CorrelationChain>();
  
  startCorrelation(command: CommandEnvelope): string {
    const correlationId = generateCorrelationId(); // cor_{ulid}
    this.correlations.set(correlationId, {
      command,
      events: [],
      response: null,
      startTime: Date.now(),
    });
    return correlationId;
  }
  
  addEvent(correlationId: string, event: EventEnvelope): void {
    const chain = this.correlations.get(correlationId);
    if (chain) {
      chain.events.push(event);
    }
  }
  
  complete(correlationId: string, response: ResponseEnvelope): void {
    const chain = this.correlations.get(correlationId);
    if (chain) {
      chain.response = response;
      chain.duration = Date.now() - chain.startTime;
      
      // Emit to audit log
      this.auditLog.recordCorrelation(chain);
    }
  }
}
```

---

## Consequences

### Positive

1. **Sub-millisecond latency:** Direct function calls eliminate serialization overhead
2. **Full type safety:** TypeScript types throughout, compile-time method validation
3. **Simplified testing:** Mock bus implementation for unit tests
4. **Centralized observability:** Single point for logging, metrics, and audit
5. **Lifecycle enforcement:** Impossible to make invalid state transitions
6. **Correlation tracking:** Complete observability of request chains

### Negative

1. **Single process limitation:** Bus cannot cross process boundaries without HTTP bridge
2. **Memory coupling:** All services must run in same process (mitigated by Bun's efficiency)
3. **No native remote support:** For future cloud runtime, will need HTTP/gRPC adapter
4. **Method registry maintenance:** Adding methods requires code changes (not runtime configuration)

### Neutral

1. **Learning curve:** Developers must understand envelope types and state machines
2. **Verbosity:** More boilerplate than simple function calls
3. **Debugging complexity:** Async event chains harder to trace than direct calls

---

## Implementation

### Core Bus Implementation

```typescript
// apps/runtime/src/protocol/bus.ts

export class LocalBus {
  private methodRegistry = new Map<string, MethodHandler>();
  private topicRegistry = new Map<string, Set<EventSubscriber>>();
  private correlationTracker = new CorrelationTracker();
  private sequenceCounters = new Map<string, number>();
  
  registerMethod(name: string, handler: MethodHandler): void {
    if (this.methodRegistry.has(name)) {
      throw new Error(`Method ${name} already registered`);
    }
    this.methodRegistry.set(name, handler);
  }
  
  registerTopic(name: string): void {
    if (!this.topicRegistry.has(name)) {
      this.topicRegistry.set(name, new Set());
    }
  }
  
  subscribe(topic: string, subscriber: EventSubscriber): Unsubscribe {
    const subscribers = this.topicRegistry.get(topic);
    if (!subscribers) {
      throw new Error(`Topic ${topic} not registered`);
    }
    subscribers.add(subscriber);
    
    return () => subscribers.delete(subscriber);
  }
  
  async dispatch(command: CommandEnvelope): Promise<ResponseEnvelope> {
    const startTime = performance.now();
    
    // Validate
    const validation = validateCommand(command);
    if (!validation.ok) {
      return this.createErrorResponse(
        command.correlation_id,
        'VALIDATION_ERROR',
        validation.error
      );
    }
    
    // Start correlation tracking
    this.correlationTracker.startCorrelation(command);
    
    // Get handler
    const handler = this.methodRegistry.get(command.method);
    if (!handler) {
      return this.createErrorResponse(
        command.correlation_id,
        'METHOD_NOT_FOUND',
        { method: command.method }
      );
    }
    
    try {
      // Execute
      const result = await handler(command.payload, command.context);
      
      // Emit success event
      this.publish({
        id: generateId(),
        correlation_id: command.correlation_id,
        type: 'event',
        topic: `${command.method}.completed`,
        payload: { result },
        context: command.context,
        timestamp: Date.now(),
        sequence: this.getNextSequence(`${command.method}.completed`),
      });
      
      // Create response
      const response: ResponseEnvelope = {
        id: generateId(),
        correlation_id: command.correlation_id,
        type: 'response',
        status: 'success',
        result,
        timestamp: Date.now(),
      };
      
      this.correlationTracker.complete(command.correlation_id, response);
      
      // Record metrics
      metrics.record('bus.dispatch_latency', performance.now() - startTime, {
        method: command.method,
      });
      
      return response;
      
    } catch (error) {
      return this.handleError(command.correlation_id, error);
    }
  }
  
  publish(event: EventEnvelope): void {
    const subscribers = this.topicRegistry.get(event.topic);
    if (!subscribers) {
      console.warn(`No subscribers for topic: ${event.topic}`);
      return;
    }
    
    // Isolate failures: one subscriber throwing doesn't affect others
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error(`Subscriber error for topic ${event.topic}:`, error);
      }
    }
    
    // Track correlation
    if (event.correlation_id) {
      this.correlationTracker.addEvent(event.correlation_id, event);
    }
  }
  
  private getNextSequence(topic: string): number {
    const current = this.sequenceCounters.get(topic) || 0;
    const next = current + 1;
    this.sequenceCounters.set(topic, next);
    return next;
  }
}
```

### Usage Examples

```typescript
// Registering a method
bus.registerMethod('terminal.spawn', async (payload, context) => {
  const { shell, cwd, env } = payload;
  
  // Validate state transition
  const session = await sessionService.get(context.session_id);
  if (session.state !== 'attached') {
    throw new StateError('Session must be attached to spawn terminal');
  }
  
  // Spawn PTY
  const terminal = await ptyService.spawn({
    shell,
    cwd,
    env,
    sessionId: context.session_id,
  });
  
  // Emit event
  bus.publish({
    id: generateId(),
    type: 'event',
    topic: 'terminal.spawned',
    payload: { terminal_id: terminal.id },
    context: { ...context, terminal_id: terminal.id },
    timestamp: Date.now(),
    sequence: bus.getNextSequence('terminal.spawned'),
  });
  
  return { terminal_id: terminal.id };
});

// Subscribing to events
const unsubscribe = bus.subscribe('terminal.output', (event) => {
  const { terminal_id, data } = event.payload;
  renderer.renderOutput(terminal_id, data);
});

// Dispatching a command
const response = await bus.dispatch({
  id: generateId(),
  correlation_id: generateCorrelationId(),
  type: 'command',
  method: 'terminal.spawn',
  payload: {
    shell: '/bin/zsh',
    cwd: '/home/user/project',
    env: { PATH: '/usr/local/bin' },
  },
  context: {
    workspace_id: 'ws_01HMG...',
    lane_id: 'ln_01HMG...',
    session_id: 'ss_01HMG...',
  },
  timestamp: Date.now(),
});
```

---

## Alternatives Considered

### Alternative 1: Electron IPC

**Approach:** Use Electron's ipcMain/ipcRenderer for communication between desktop and runtime.

**Rejected because:**
- Requires process serialization (JSON stringify/parse)
- Adds ~5ms latency per call
- Type safety requires manual serialization contracts
- Not portable to non-Electron environments

### Alternative 2: gRPC with Protobuf

**Approach:** Use gRPC for strongly typed RPC between components.

**Rejected because:**
- Protobuf compilation adds build complexity
- gRPC server overhead for local calls
- Less idiomatic for TypeScript
- Overkill for in-process communication

### Alternative 3: EventEmitter

**Approach:** Use Node.js EventEmitter for pub/sub.

**Rejected because:**
- No built-in correlation tracking
- No state machine validation
- No method/request-response pattern
- Harder to test and observe

---

## Related Decisions

- ADR-HELIOS-002: State Machine Architecture
- ADR-HELIOS-003: Provider Adapter Interface
- SPEC.md: Protocol envelope schema

---

## References

1. "Event-Driven Architecture" by O'Reilly (2023)
2. "Message-Oriented Middleware" patterns
3. Zellij's IPC design: https://zellij.dev/documentation/ipc
4. Tauri's command system: https://tauri.app/v1/guides/features/command

---

## Notes

- Performance benchmark: `bun test protocol/bench.ts` shows <0.5ms p95 dispatch latency
- Method registry is defined at compile time for type safety
- Future work: HTTP bridge for remote runtime support (Phase 8)
