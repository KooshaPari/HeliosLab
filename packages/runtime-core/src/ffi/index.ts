/**
 * HeliosLab FFI Bridge Layer
 * 
 * TypeScript wrappers for native Zig/Rust/Go/Mojo packages.
 * Uses Bun FFI for zero-copy, zero-overhead interop.
 */
import { dlopen, FFIType, type TypedFFIFunction } from "bun:ffi";
import { join } from "path";

// ============================================================================
// Library loader
// ============================================================================

const NATIVE_DIR = join(import.meta.dir, "../..");

type FFIibrary = {
  symbols: Record<string, TypedFFIFunction>;
  close: () => void;
};

function loadLib(name: string, symbols: Record<string, TypedFFIFunction>): FFIibrary {
  const paths: Record<string, string[]> = {
    "helios-pty": ["libhelios-pty.so", "libhelios-pty.dylib"],
    "helios-persistence": ["libhelios_persistence.so", "libhelios_persistence.dylib"],
    "helios-orchestrator": ["libhelios-orchestrator.so", "libhelios-orchestrator.dylib"],
    "helios-device": ["libhelios-device.so", "libhelios-device.dylib"],
  };

  const candidates = paths[name] || [name];
  for (const candidate of candidates) {
    try {
      const fullPath = join(NATIVE_DIR, candidate);
      return dlopen(fullPath, symbols);
    } catch {
      continue;
    }
  }
  throw new Error(`Failed to load native library: ${name}`);
}

// ============================================================================
// PTY Pool (Zig)
// ============================================================================

const ptyLib = loadLib("helios-pty", {
  pty_pool_create: { args: [FFIType.u32], returns: FFIType.ptr },
  pty_pool_spawn: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
  pty_pool_write: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  pty_pool_read: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  pty_pool_resize: {
    args: [FFIType.ptr, FFIType.i32, FFIType.u16, FFIType.u16],
    returns: FFIType.void,
  },
  pty_pool_destroy: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.void },
  pty_pool_destroy_all: { args: [FFIType.ptr], returns: FFIType.void },
});

export class PTYPool {
  private ptr: any;

  constructor(maxPty: number = 1000) {
    this.ptr = ptyLib.symbols.pty_pool_create(maxPty);
    if (!this.ptr) throw new Error("Failed to create PTY pool");
  }

  spawn(shell: string, cwd: string, cols: number, rows: number): number {
    const id = ptyLib.symbols.pty_pool_spawn(this.ptr, shell, cwd, cols, rows);
    if (id < 0) throw new Error("Failed to spawn PTY");
    return id;
  }

  write(ptyId: number, data: Uint8Array): number {
    return ptyLib.symbols.pty_pool_write(this.ptr, ptyId, data, data.length);
  }

  read(ptyId: number, buf: Uint8Array): number {
    return ptyLib.symbols.pty_pool_read(this.ptr, ptyId, buf, buf.length);
  }

  resize(ptyId: number, cols: number, rows: number): void {
    ptyLib.symbols.pty_pool_resize(this.ptr, ptyId, cols, rows);
  }

  destroy(ptyId: number): void {
    ptyLib.symbols.pty_pool_destroy(this.ptr, ptyId);
  }

  destroyAll(): void {
    ptyLib.symbols.pty_pool_destroy_all(this.ptr);
  }
}

// ============================================================================
// Persistence (Rust)
// ============================================================================

const persistenceLib = loadLib("helios-persistence", {
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
    args: [FFIType.ptr, FFIType.cstring, FFIType.i32, FFIType.i32, FFIType.f64, FFIType.cstring],
    returns: FFIType.i32,
  },
  helios_db_get_token_stats: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.ptr,
  },
  helios_db_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  helios_db_close: { args: [FFIType.ptr], returns: FFIType.void },
});

export class HeliosDB {
  private ptr: any;

  constructor(path: string = "~/.helioslab/helioslab.db") {
    this.ptr = persistenceLib.symbols.helios_db_open(path);
    if (!this.ptr) throw new Error("Failed to open database");
  }

  createConversation(id: string, title: string, modelId: string): number {
    return persistenceLib.symbols.helios_db_create_conversation(this.ptr, id, title, modelId);
  }

  addMessage(conversationId: string, role: string, content: string, timestamp: number = 0): number {
    return persistenceLib.symbols.helios_db_add_message(
      this.ptr, conversationId, role, content, timestamp
    );
  }

  getMessages(conversationId: string, limit: number = 50, offset: number = 0): any[] {
    const ptr = persistenceLib.symbols.helios_db_get_messages(
      this.ptr, conversationId, limit, offset
    );
    const json = ptrToString(ptr);
    return JSON.parse(json);
  }

  searchMessages(query: string, limit: number = 20): any[] {
    const ptr = persistenceLib.symbols.helios_db_search_messages(this.ptr, query, limit);
    const json = ptrToString(ptr);
    return JSON.parse(json);
  }

  recordTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    costCents: number,
    backend: string
  ): number {
    return persistenceLib.symbols.helios_db_record_token_usage(
      this.ptr, sessionId, promptTokens, completionTokens, costCents, backend
    );
  }

  getTokenStats(sessionId: string): any {
    const ptr = persistenceLib.symbols.helios_db_get_token_stats(this.ptr, sessionId);
    const json = ptrToString(ptr);
    return JSON.parse(json);
  }

  close(): void {
    persistenceLib.symbols.helios_db_close(this.ptr);
  }
}

// ============================================================================
// Orchestrator (Go)
// ============================================================================

const orchestratorLib = loadLib("helios-orchestrator", {
  orchestrator_create: { args: [], returns: FFIType.ptr },
  orchestrator_create_session: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring],
    returns: FFIType.i32,
  },
  orchestrator_destroy_session: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.i32,
  },
  orchestrator_list_sessions: { args: [FFIType.ptr], returns: FFIType.ptr },
  orchestrator_get_status: { args: [FFIType.ptr], returns: FFIType.ptr },
  orchestrator_free_string: { args: [FFIType.ptr], returns: FFIType.void },
});

export class Orchestrator {
  private ptr: any;

  constructor() {
    this.ptr = orchestratorLib.symbols.orchestrator_create();
    if (!this.ptr) throw new Error("Failed to create orchestrator");
  }

  createSession(workspaceId: string, laneId: string): number {
    return orchestratorLib.symbols.orchestrator_create_session(
      this.ptr, workspaceId, laneId
    );
  }

  destroySession(sessionId: string): boolean {
    return orchestratorLib.symbols.orchestrator_destroy_session(
      this.ptr, sessionId
    ) === 0;
  }

  listSessions(): any[] {
    const ptr = orchestratorLib.symbols.orchestrator_list_sessions(this.ptr);
    const json = ptrToString(ptr);
    orchestratorLib.symbols.orchestrator_free_string(ptr);
    return JSON.parse(json);
  }

  getStatus(): any {
    const ptr = orchestratorLib.symbols.orchestrator_get_status(this.ptr);
    const json = ptrToString(ptr);
    orchestratorLib.symbols.orchestrator_free_string(ptr);
    return JSON.parse(json);
  }
}

// ============================================================================
// Device Manager (Go)
// ============================================================================

const deviceLib = loadLib("helios-device", {
  device_manager_create: { args: [], returns: FFIType.ptr },
  device_manager_add_device: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.cstring],
    returns: FFIType.i32,
  },
  device_manager_list_devices: { args: [FFIType.ptr], returns: FFIType.ptr },
  device_manager_connect: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.i32 },
  device_manager_disconnect: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.i32 },
  device_manager_exec: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.cstring],
    returns: FFIType.ptr,
  },
  device_manager_get_metrics: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.ptr,
  },
  device_manager_free_string: { args: [FFIType.ptr], returns: FFIType.void },
});

export class DeviceManager {
  private ptr: any;

  constructor() {
    this.ptr = deviceLib.symbols.device_manager_create();
    if (!this.ptr) throw new Error("Failed to create device manager");
  }

  addDevice(
    name: string,
    host: string,
    port: number,
    user: string,
    keyPath: string
  ): number {
    return deviceLib.symbols.device_manager_add_device(
      this.ptr, name, host, port, user, keyPath
    );
  }

  listDevices(): any[] {
    const ptr = deviceLib.symbols.device_manager_list_devices(this.ptr);
    const json = ptrToString(ptr);
    deviceLib.symbols.device_manager_free_string(ptr);
    return JSON.parse(json);
  }

  connect(deviceId: string): boolean {
    return deviceLib.symbols.device_manager_connect(this.ptr, deviceId) === 0;
  }

  disconnect(deviceId: string): boolean {
    return deviceLib.symbols.device_manager_disconnect(this.ptr, deviceId) === 0;
  }

  exec(deviceId: string, command: string): any {
    const ptr = deviceLib.symbols.device_manager_exec(this.ptr, deviceId, command);
    const json = ptrToString(ptr);
    deviceLib.symbols.device_manager_free_string(ptr);
    return JSON.parse(json);
  }

  getMetrics(deviceId: string): any {
    const ptr = deviceLib.symbols.device_manager_get_metrics(this.ptr, deviceId);
    const json = ptrToString(ptr);
    deviceLib.symbols.device_manager_free_string(ptr);
    return JSON.parse(json);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function ptrToString(ptr: any): string {
  // Read null-terminated string from pointer
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(ptr);
  let len = 0;
  while (bytes[len] !== 0 && len < bytes.length) len++;
  return decoder.decode(bytes.slice(0, len));
}

// ============================================================================
// Exports
// ============================================================================

export { PTYPool, HeliosDB, Orchestrator, DeviceManager };
