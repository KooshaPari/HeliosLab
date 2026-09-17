/**
 * HeliosLab FFI bridge.
 *
 * TypeScript wrappers over the native Zig / Rust / Go packages, reached through
 * Bun's FFI. Everything here is lazy: importing this module never touches a
 * `.so`/`.dylib`, so the app keeps working when a native package has not been
 * compiled yet. Call `nativeStatus()` to find out what is actually available.
 *
 * Reading a C string back out of native code requires `CString` from "bun:ffi".
 * `new Uint8Array(ptr)` does NOT work: a Bun pointer is an address, not a
 * buffer, and constructing a typed array over it reads unmapped memory.
 */
import { CString, dlopen, FFIType, type FFIFunction } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

type Symbols = Record<string, FFIFunction>;
type Library = ReturnType<typeof dlopen>;

/** Everything the bridge can fail to find. */
export type NativeComponent = "pty" | "persistence" | "orchestrator" | "device";

export type NativeLoadState =
  | { ok: true; path: string }
  | { ok: false; reason: string };

const COMPONENT_FILES: Record<NativeComponent, string[]> = {
  pty: ["libhelios-pty.dylib", "libhelios-pty.so", "helios-pty.dll"],
  persistence: [
    "libhelios_persistence.dylib",
    "libhelios_persistence.so",
    "helios_persistence.dll",
  ],
  orchestrator: [
    "libhelios-orchestrator.dylib",
    "libhelios-orchestrator.so",
    "helios-orchestrator.dll",
  ],
  device: ["libhelios-device.dylib", "libhelios-device.so", "helios-device.dll"],
};

/**
 * Directories searched for a built native library, most specific first.
 * `zig-out/lib` is Zig's default install prefix, `target/release` is Cargo's.
 */
const SEARCH_DIRS = [
  "../../../packages/pty-pool/zig-out/lib",
  "../../../packages/pty-pool/lib",
  "../../../packages/persistence/target/release",
  "../../../packages/orchestrator",
  "../../../packages/device-manager",
  "../../../native",
];

const HERE = import.meta.dir;

const loaded = new Map<NativeComponent, Library | null>();
const loadState = new Map<NativeComponent, NativeLoadState>();

function resolveLibrary(component: NativeComponent): string | null {
  for (const dir of SEARCH_DIRS) {
    const base = join(HERE, dir);
    for (const file of COMPONENT_FILES[component]) {
      const candidate = join(base, file);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function tryLoad(component: NativeComponent, symbols: Symbols): Library | null {
  const cached = loaded.get(component);
  if (cached !== undefined) return cached;

  const path = resolveLibrary(component);
  if (path === null) {
    loadState.set(component, {
      ok: false,
      reason: `${component}: no build output found on disk`,
    });
    loaded.set(component, null);
    return null;
  }

  try {
    const lib = dlopen(path, symbols);
    loaded.set(component, lib);
    loadState.set(component, { ok: true, path });
    return lib;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    loadState.set(component, { ok: false, reason: `${component}: ${reason}` });
    loaded.set(component, null);
    return null;
  }
}

/** Report which native components loaded. Never throws. */
export function nativeStatus(): Record<NativeComponent, NativeLoadState> {
  // Touch each component so the map is populated.
  getPtyLib();
  getPersistenceLib();
  getOrchestratorLib();
  getDeviceLib();
  return {
    pty: loadState.get("pty") ?? { ok: false, reason: "not probed" },
    persistence: loadState.get("persistence") ?? { ok: false, reason: "not probed" },
    orchestrator: loadState.get("orchestrator") ?? { ok: false, reason: "not probed" },
    device: loadState.get("device") ?? { ok: false, reason: "not probed" },
  };
}

export class NativeUnavailableError extends Error {
  constructor(readonly component: NativeComponent) {
    const state = loadState.get(component);
    const detail = state && !state.ok ? state.reason : "unknown reason";
    super(
      `Native component "${component}" is unavailable (${detail}). ` +
        "Run `bun run build:native` to compile the native packages.",
    );
    this.name = "NativeUnavailableError";
  }
}

function require_(component: NativeComponent, lib: Library | null): Library {
  if (lib === null) throw new NativeUnavailableError(component);
  return lib;
}

/** Read a `char *` returned by native code and free a JS-side copy. */
function readCString(ptr: number | null): string {
  if (ptr === null || ptr === 0) return "";
  return CString(ptr);
}

// ---------------------------------------------------------------------------
// PTY pool (Zig)
// ---------------------------------------------------------------------------

const PTY_SYMBOLS: Symbols = {
  pty_pool_create: { args: [FFIType.u32], returns: FFIType.i32 },
  pty_pool_spawn: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
  pty_pool_pump: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_read: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  pty_pool_readable: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_write: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  pty_pool_resize: {
    args: [FFIType.i32, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
  pty_pool_state: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_exit_code: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_reap: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_destroy: { args: [FFIType.i32], returns: FFIType.i32 },
  pty_pool_destroy_all: { args: [], returns: FFIType.void },
  pty_pool_live_count: { args: [], returns: FFIType.i32 },
  pty_pool_available: { args: [], returns: FFIType.i32 },
  pty_pool_abi_version: { args: [], returns: FFIType.u32 },
};

let ptyLib: Library | null | undefined;
function getPtyLib(): Library | null {
  if (ptyLib === undefined) ptyLib = tryLoad("pty", PTY_SYMBOLS);
  return ptyLib;
}

/** C ABI revision this bridge was written against. */
export const PTY_ABI_VERSION = 2;

export const PtyState = {
  closed: 0,
  running: 1,
  exited: 2,
  errored: 3,
} as const;

export interface PtySpawnOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export class PtyPool {
  #lib: Library;
  #maxPty: number;
  #handles = new Set<number>();

  constructor(maxPty = 1024) {
    this.#lib = require_("pty", getPtyLib());

    const actual = this.#lib.symbols.pty_pool_abi_version() as number;
    if (actual !== PTY_ABI_VERSION) {
      throw new Error(
        `PTY ABI mismatch: library reports ${actual}, bridge expects ${PTY_ABI_VERSION}. Rebuild with \`bun run build:native\`.`,
      );
    }

    const rc = this.#lib.symbols.pty_pool_create(maxPty) as number;
    if (rc !== 0) {
      throw new Error(`pty_pool_create(${maxPty}) failed with ${rc}`);
    }
    this.#maxPty = maxPty;
  }

  get maxPty(): number {
    return this.#maxPty;
  }

  get liveCount(): number {
    return this.#lib.symbols.pty_pool_live_count() as number;
  }

  get available(): number {
    return this.#lib.symbols.pty_pool_available() as number;
  }

  spawn(options: PtySpawnOptions = {}): number {
    const shell = options.shell ?? "/bin/zsh";
    const cwd = options.cwd ?? "";
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;

    const handle = this.#lib.symbols.pty_pool_spawn(shell, cwd, cols, rows) as number;
    if (handle < 0) throw new Error(`pty_pool_spawn failed with ${handle}`);
    this.#handles.add(handle);
    return handle;
  }

  /** Pull whatever the kernel has ready into the session's buffer. */
  pump(handle: number): number {
    return this.#lib.symbols.pty_pool_pump(handle) as number;
  }

  /** Bytes buffered and waiting to be read. */
  readable(handle: number): number {
    return this.#lib.symbols.pty_pool_readable(handle) as number;
  }

  /** Drain buffered output. Allocates only the caller's buffer. */
  read(handle: number, maxBytes = 64 * 1024): Uint8Array {
    const out = new Uint8Array(maxBytes);
    const n = this.#lib.symbols.pty_pool_read(handle, out, maxBytes) as number;
    if (n < 0) throw new Error(`pty_pool_read failed with ${n}`);
    return out.subarray(0, n);
  }

  write(handle: number, data: Uint8Array | string): number {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const n = this.#lib.symbols.pty_pool_write(handle, bytes, bytes.byteLength) as number;
    if (n < 0) throw new Error(`pty_pool_write failed with ${n}`);
    return n;
  }

  resize(handle: number, cols: number, rows: number): void {
    const rc = this.#lib.symbols.pty_pool_resize(handle, cols, rows) as number;
    if (rc !== 0) throw new Error(`pty_pool_resize failed with ${rc}`);
  }

  state(handle: number): number {
    return this.#lib.symbols.pty_pool_state(handle) as number;
  }

  exitCode(handle: number): number {
    return this.#lib.symbols.pty_pool_exit_code(handle) as number;
  }

  /** Non-blocking reap. Returns true when the child finished this call. */
  reap(handle: number): boolean {
    return (this.#lib.symbols.pty_pool_reap(handle) as number) === 1;
  }

  destroy(handle: number): void {
    if (!this.#handles.has(handle)) return;
    this.#lib.symbols.pty_pool_destroy(handle);
    this.#handles.delete(handle);
  }

  destroyAll(): void {
    this.#lib.symbols.pty_pool_destroy_all();
    this.#handles.clear();
  }
}

// ---------------------------------------------------------------------------
// Persistence (Rust)
// ---------------------------------------------------------------------------

const PERSISTENCE_SYMBOLS: Symbols = {
  helios_db_open: { args: [FFIType.cstring], returns: FFIType.ptr },
  helios_db_create_conversation: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.cstring],
    returns: FFIType.i32,
  },
  helios_db_add_message: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.i64],
    returns: FFIType.i32,
  },
  helios_db_get_messages: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.i32, FFIType.i32],
    returns: FFIType.ptr,
  },
  helios_db_search_messages: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.i32],
    returns: FFIType.ptr,
  },
  helios_db_record_token_usage: {
    args: [
      FFIType.ptr,
      FFIType.cstring,
      FFIType.i32,
      FFIType.i32,
      FFIType.f64,
      FFIType.cstring,
    ],
    returns: FFIType.i32,
  },
  helios_db_get_token_stats: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.ptr,
  },
  helios_db_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  helios_db_close: { args: [FFIType.ptr], returns: FFIType.void },
};

let persistenceLib: Library | null | undefined;
function getPersistenceLib(): Library | null {
  if (persistenceLib === undefined) {
    persistenceLib = tryLoad("persistence", PERSISTENCE_SYMBOLS);
  }
  return persistenceLib;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
}

export interface TokenStats {
  sessionId: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostCents: number;
  usageCount: number;
}

export class HeliosDb {
  #lib: Library;
  #db: number;

  constructor(path: string) {
    this.#lib = require_("persistence", getPersistenceLib());
    this.#db = this.#lib.symbols.helios_db_open(path) as number;
    if (this.#db === 0) throw new Error(`helios_db_open(${path}) returned null`);
  }

  /** Take ownership of the string the Rust side allocated, then free it. */
  #takeString(ptr: number): string {
    const text = readCString(ptr);
    this.#lib.symbols.helios_db_free_string(ptr);
    return text;
  }

  createConversation(id: string, title: string, modelId: string): void {
    const rc = this.#lib.symbols.helios_db_create_conversation(
      this.#db,
      id,
      title,
      modelId,
    ) as number;
    if (rc !== 0) throw new Error(`createConversation returned ${rc}`);
  }

  addMessage(
    conversationId: string,
    role: StoredMessage["role"],
    content: string,
    timestampSeconds = 0,
  ): void {
    const rc = this.#lib.symbols.helios_db_add_message(
      this.#db,
      conversationId,
      role,
      content,
      timestampSeconds,
    ) as number;
    if (rc !== 0) throw new Error(`addMessage returned ${rc}`);
  }

  getMessages(conversationId: string, limit = 50, offset = 0): StoredMessage[] {
    const ptr = this.#lib.symbols.helios_db_get_messages(
      this.#db,
      conversationId,
      limit,
      offset,
    ) as number;
    const raw = this.#takeString(ptr);
    return raw === "" ? [] : (JSON.parse(raw) as StoredMessage[]);
  }

  searchMessages(query: string, limit = 20): StoredMessage[] {
    const ptr = this.#lib.symbols.helios_db_search_messages(
      this.#db,
      query,
      limit,
    ) as number;
    const raw = this.#takeString(ptr);
    return raw === "" ? [] : (JSON.parse(raw) as StoredMessage[]);
  }

  recordTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    costCents: number,
    backend: string,
  ): void {
    const rc = this.#lib.symbols.helios_db_record_token_usage(
      this.#db,
      sessionId,
      promptTokens,
      completionTokens,
      costCents,
      backend,
    ) as number;
    if (rc !== 0) throw new Error(`recordTokenUsage returned ${rc}`);
  }

  getTokenStats(sessionId: string): TokenStats | null {
    const ptr = this.#lib.symbols.helios_db_get_token_stats(
      this.#db,
      sessionId,
    ) as number;
    const raw = this.#takeString(ptr);
    if (raw === "" || raw === "{}") return null;
    return JSON.parse(raw) as TokenStats;
  }

  close(): void {
    if (this.#db !== 0) {
      this.#lib.symbols.helios_db_close(this.#db);
      this.#db = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator (Go)
// ---------------------------------------------------------------------------

const ORCHESTRATOR_SYMBOLS: Symbols = {
  HeliosOrchestratorNew: { args: [], returns: FFIType.ptr },
  HeliosOrchestratorCreateSession: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.i64],
    returns: FFIType.ptr,
  },
  HeliosOrchestratorAddLane: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring],
    returns: FFIType.ptr,
  },
  HeliosOrchestratorSpawnAgent: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.cstring],
    returns: FFIType.ptr,
  },
  HeliosOrchestratorRecordTokens: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.i64],
    returns: FFIType.i32,
  },
  HeliosOrchestratorDestroySession: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.i32,
  },
  HeliosOrchestratorListSessions: { args: [FFIType.ptr], returns: FFIType.ptr },
  HeliosOrchestratorStatus: { args: [FFIType.ptr], returns: FFIType.ptr },
  HeliosOrchestratorFree: { args: [FFIType.ptr], returns: FFIType.void },
  HeliosOrchestratorClose: { args: [FFIType.ptr], returns: FFIType.void },
};

let orchestratorLib: Library | null | undefined;
function getOrchestratorLib(): Library | null {
  if (orchestratorLib === undefined) {
    orchestratorLib = tryLoad("orchestrator", ORCHESTRATOR_SYMBOLS);
  }
  return orchestratorLib;
}

export interface SessionSummary {
  id: string;
  workspace_id: string;
  state: string;
  budget: { limit: number; used: number; remaining: number };
}

export interface OrchestratorStatus {
  sessions: number;
  active_sessions: number;
  agents: number;
  tokens_used: number;
}

/**
 * String-returning calls hand back a freshly allocated C string, or NULL on
 * failure. Ownership transfers to the caller, which must free it.
 */

export class Orchestrator {
  #lib: Library;
  #ptr: number;

  constructor() {
    this.#lib = require_("orchestrator", getOrchestratorLib());
    this.#ptr = this.#lib.symbols.HeliosOrchestratorNew() as number;
    if (this.#ptr === 0) throw new Error("HeliosOrchestratorNew returned null");
  }

  #takeString(addr: number): string {
    const text = readCString(addr);
    this.#lib.symbols.HeliosOrchestratorFree(addr);
    return text;
  }

  #callId(symbol: string, args: unknown[], errorContext: string): string {
    const fn = this.#lib.symbols[symbol] as (...a: unknown[]) => number | null;
    const addr = fn(this.#ptr, ...args);
    if (addr === null || addr === 0) {
      throw new Error(`${errorContext} failed (native returned no id)`);
    }
    return this.#takeString(addr);
  }

  createSession(workspaceId: string, tokenBudget = 0): string {
    return this.#callId(
      "HeliosOrchestratorCreateSession",
      [workspaceId, tokenBudget],
      "createSession",
    );
  }

  addLane(sessionId: string, name: string): string {
    return this.#callId(
      "HeliosOrchestratorAddLane",
      [sessionId, name],
      "addLane",
    );
  }

  spawnAgent(sessionId: string, laneId: string, agentType: string): string {
    return this.#callId(
      "HeliosOrchestratorSpawnAgent",
      [sessionId, laneId, agentType],
      "spawnAgent",
    );
  }

  /** Returns true when the session has now exceeded its token budget. */
  recordTokens(sessionId: string, tokens: number): boolean {
    const rc = this.#lib.symbols.HeliosOrchestratorRecordTokens(
      this.#ptr,
      sessionId,
      tokens,
    ) as number;
    if (rc < 0) throw new Error(`recordTokens returned ${rc}`);
    return rc === 1;
  }

  destroySession(sessionId: string): void {
    const rc = this.#lib.symbols.HeliosOrchestratorDestroySession(
      this.#ptr,
      sessionId,
    ) as number;
    if (rc !== 0) throw new Error(`destroySession returned ${rc}`);
  }

  listSessions(): SessionSummary[] {
    const ptr = this.#lib.symbols.HeliosOrchestratorListSessions(this.#ptr) as number;
    const raw = this.#takeString(ptr);
    return raw === "" ? [] : (JSON.parse(raw) as SessionSummary[]);
  }

  status(): OrchestratorStatus {
    const ptr = this.#lib.symbols.HeliosOrchestratorStatus(this.#ptr) as number;
    const raw = this.#takeString(ptr);
    return JSON.parse(raw) as OrchestratorStatus;
  }

  close(): void {
    if (this.#ptr !== 0) {
      this.#lib.symbols.HeliosOrchestratorClose(this.#ptr);
      this.#ptr = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Device manager (Go)
// ---------------------------------------------------------------------------

const DEVICE_SYMBOLS: Symbols = {
  HeliosDevicesNew: { args: [], returns: FFIType.ptr },
  HeliosDevicesAdd: {
    args: [
      FFIType.ptr,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.i32,
      FFIType.cstring,
      FFIType.cstring,
    ],
    returns: FFIType.ptr,
  },
  HeliosDevicesList: { args: [FFIType.ptr], returns: FFIType.ptr },
  HeliosDevicesConnect: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.i32,
  },
  HeliosDevicesDisconnect: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.i32,
  },
  HeliosDevicesRemove: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.i32,
  },
  HeliosDevicesExec: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring],
    returns: FFIType.ptr,
  },
  HeliosDevicesFree: { args: [FFIType.ptr], returns: FFIType.void },
  HeliosDevicesClose: { args: [FFIType.ptr], returns: FFIType.void },
};

let deviceLib: Library | null | undefined;
function getDeviceLib(): Library | null {
  if (deviceLib === undefined) deviceLib = tryLoad("device", DEVICE_SYMBOLS);
  return deviceLib;
}

export interface DeviceSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  state: string;
}

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export class DeviceManager {
  #lib: Library;
  #ptr: number;

  constructor() {
    this.#lib = require_("device", getDeviceLib());
    this.#ptr = this.#lib.symbols.HeliosDevicesNew() as number;
    if (this.#ptr === 0) throw new Error("HeliosDevicesNew returned null");
  }

  #takeString(addr: number): string {
    const text = readCString(addr);
    this.#lib.symbols.HeliosDevicesFree(addr);
    return text;
  }

  add(
    name: string,
    host: string,
    port: number,
    user: string,
    keyPath: string,
  ): string {
    const addr = this.#lib.symbols.HeliosDevicesAdd(
      this.#ptr,
      name,
      host,
      port,
      user,
      keyPath,
    ) as number | null;
    if (addr === null || addr === 0) {
      throw new Error("devices.add failed (native returned no id)");
    }
    return this.#takeString(addr);
  }

  list(): DeviceSummary[] {
    const ptr = this.#lib.symbols.HeliosDevicesList(this.#ptr) as number;
    const raw = this.#takeString(ptr);
    return raw === "" ? [] : (JSON.parse(raw) as DeviceSummary[]);
  }

  connect(deviceId: string): void {
    const rc = this.#lib.symbols.HeliosDevicesConnect(this.#ptr, deviceId) as number;
    if (rc !== 0) throw new Error(`devices.connect returned ${rc}`);
  }

  disconnect(deviceId: string): void {
    const rc = this.#lib.symbols.HeliosDevicesDisconnect(this.#ptr, deviceId) as number;
    if (rc !== 0) throw new Error(`devices.disconnect returned ${rc}`);
  }

  remove(deviceId: string): void {
    const rc = this.#lib.symbols.HeliosDevicesRemove(this.#ptr, deviceId) as number;
    if (rc !== 0) throw new Error(`devices.remove returned ${rc}`);
  }

  exec(deviceId: string, command: string): ExecOutcome {
    const addr = this.#lib.symbols.HeliosDevicesExec(
      this.#ptr,
      deviceId,
      command,
    ) as number | null;
    if (addr === null || addr === 0) {
      throw new Error("devices.exec failed (native returned no result)");
    }
    const raw = this.#takeString(addr);
    return JSON.parse(raw) as ExecOutcome;
  }

  close(): void {
    if (this.#ptr !== 0) {
      this.#lib.symbols.HeliosDevicesClose(this.#ptr);
      this.#ptr = 0;
    }
  }
}
