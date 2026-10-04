//! Windows pseudo-console backend (ConPTY).
//!
//! Mirrors `pty_unix.zig` so `main.zig` can select a backend at comptime
//! without changing its call sites. The struct layouts below are the
//! documented, version-stable ABI of kernel32's pseudo-console API (stable
//! since Windows 10 1809); the constants were checked against the Windows SDK
//! headers, matching the header-reading discipline pty_unix.zig documents for
//! the macOS side.
//!
//! Design notes:
//! - ConPTY has no master/slave fd pair. You get an HPCON plus two pipe
//!   pairs. The pool's slot stores an `fd: i32`, so the handles we poll and
//!   write are round-tripped through `handle_to_fd`/`handle_from_fd` and the
//!   HPCON rides separately in the spawn result.
//! - Non-blocking reads use `PeekNamedPipe` + `ReadFile`. Overlapped I/O on
//!   ConPTY pipes works but requires an event per slot; peeking achieves the
//!   same pollability with no per-slot kernel objects.
//! - `last_hresult`/`last_errno` carry the failing API's code out of spawn,
//!   matching the Unix backend's diagnosability contract.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag != .windows) {
        @compileError("pty_windows.zig is Windows-only; guard imports with builtin.os.tag");
    }
}

const win = std.os.windows;
const HANDLE = win.HANDLE;
const DWORD = win.DWORD;
const BOOL = win.BOOL;

const INVALID_HANDLE_VALUE: HANDLE = @ptrFromInt(std.math.maxInt(usize));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// `COORD`, from <wincontypes.h>: two signed shorts.
pub const Coord = extern struct {
    x: c_short = 0,
    y: c_short = 0,
};

/// ConPTY handle. Opaque; owned by kernel32.
pub const HPCON = HANDLE;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HRESULT = c_int;

const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x00020016;

const EXTENDED_STARTUPINFO_PRESENT: DWORD = 0x00080000;
const CREATE_UNICODE_ENVIRONMENT: DWORD = 0x00000400;

const STILL_ACTIVE: DWORD = 259;

const TRUE = @as(BOOL, @enumFromInt(1));
const FALSE = @as(BOOL, @enumFromInt(0));

const ERROR_BROKEN_PIPE: DWORD = 109;
const ERROR_NO_DATA: DWORD = 232;

const HANDLE_FLAG_INHERIT: DWORD = 0x00000001;

// ---------------------------------------------------------------------------
// Win32 declarations
// ---------------------------------------------------------------------------

const STARTUPINFOEXW = extern struct {
    StartupInfo: win.STARTUPINFOW,
    lpAttributeList: ?*anyopaque,
};

/// Reproduced locally: Zig 0.16's std.os.windows no longer exports it with
/// this exact name, and relying on std's churn for a version-stable ABI
/// struct is what broke the build.
const PROCESS_INFORMATION = extern struct {
    hProcess: HANDLE,
    hThread: HANDLE,
    dwProcessId: DWORD,
    dwThreadId: DWORD,
};

extern "kernel32" fn CreatePseudoConsole(
    size: Coord,
    hInput: HANDLE,
    hOutput: HANDLE,
    dwFlags: DWORD,
    phPC: *HPCON,
) HRESULT;

extern "kernel32" fn ResizePseudoConsole(hPC: HPCON, size: Coord) HRESULT;

extern "kernel32" fn ClosePseudoConsole(hPC: HPCON) void;

extern "kernel32" fn InitializeProcThreadAttributeList(
    lpAttributeList: ?*anyopaque,
    dwAttributeCount: DWORD,
    dwFlags: DWORD,
    lpSize: *usize,
) BOOL;

extern "kernel32" fn UpdateProcThreadAttribute(
    lpAttributeList: ?*anyopaque,
    dwFlags: DWORD,
    Attribute: usize,
    lpValue: ?*anyopaque,
    cbSize: usize,
    lpPreviousValue: ?*anyopaque,
    lpReturnSize: ?*usize,
) BOOL;

extern "kernel32" fn DeleteProcThreadAttributeList(lpAttributeList: ?*anyopaque) void;

extern "kernel32" fn CreateProcessW(
    lpApplicationName: ?[*:0]const u16,
    lpCommandLine: [*:0]const u16,
    lpProcessAttributes: ?*anyopaque,
    lpThreadAttributes: ?*anyopaque,
    bInheritHandles: BOOL,
    dwCreationFlags: DWORD,
    lpEnvironment: ?*anyopaque,
    lpCurrentDirectory: ?[*:0]const u16,
    lpStartupInfo: *STARTUPINFOEXW,
    lpProcessInformation: *PROCESS_INFORMATION,
) BOOL;

extern "kernel32" fn CreatePipe(
    hReadPipe: *HANDLE,
    hWritePipe: *HANDLE,
    lpPipeAttributes: ?*anyopaque,
    nSize: DWORD,
) BOOL;

extern "kernel32" fn SetHandleInformation(hObject: HANDLE, dwMask: DWORD, dwFlags: DWORD) BOOL;

extern "kernel32" fn ReadFile(
    hFile: HANDLE,
    lpBuffer: [*]u8,
    nNumberOfBytesToRead: DWORD,
    lpNumberOfBytesRead: *DWORD,
    lpOverlapped: ?*anyopaque,
) BOOL;

extern "kernel32" fn WriteFile(
    hFile: HANDLE,
    lpBuffer: [*]const u8,
    nNumberOfBytesToWrite: DWORD,
    lpNumberOfBytesWritten: *DWORD,
    lpOverlapped: ?*anyopaque,
) BOOL;

extern "kernel32" fn PeekNamedPipe(
    hNamedPipe: HANDLE,
    lpBuffer: ?[*]u8,
    nBufferSize: DWORD,
    lpBytesRead: ?*DWORD,
    lpTotalBytesAvail: ?*DWORD,
    lpBytesLeftThisMessage: ?*DWORD,
) BOOL;

extern "kernel32" fn CloseHandle(hObject: HANDLE) BOOL;

extern "kernel32" fn WaitForSingleObject(hHandle: HANDLE, dwMilliseconds: DWORD) DWORD;

extern "kernel32" fn GetExitCodeProcess(hProcess: HANDLE, lpExitCode: *DWORD) BOOL;

extern "kernel32" fn TerminateProcess(hProcess: HANDLE, uExitCode: u32) BOOL;

extern "kernel32" fn GetLastError() DWORD;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

pub const SpawnError = error{
    PipeFailed,
    ConptyFailed,
    AttrListInitFailed,
    AttrUpdateFailed,
    ProcessFailed,
    @"InvalidUtf8",
    OutOfMemory,
};

pub const SetNonBlockingError = error{SetNonBlockingFailed};

pub const SpawnResult = struct {
    /// The pool treats this as "the thing you poll for output". On Windows
    /// this is the ConPTY output pipe's read HANDLE, via handle_to_fd.
    master_fd: c_int,
    /// The child PROCESS handle (not a pid) via handle_to_fd. reap and
    /// terminate need the handle; converting to a pid would buy nothing.
    pid: c_int,
    /// The pseudo console. destroy() needs it to tear the console down.
    hpcon: HPCON,
    /// Input pipe write end; stored in the slot's second fd field so
    /// writeIn() can reach it.
    in_write: HANDLE,
};

pub const ReadOutcome = union(enum) {
    data: usize,
    would_block,
    eof,
};

pub const ReapResult = struct {
    reaped: bool,
    exit_code: c_int,
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// Set when spawn() fails, so callers can report the underlying HRESULT or
/// GetLastError code. Matches pty_unix.zig's diagnosability contract.
pub var last_hresult: c_int = 0;
pub var last_errno: c_int = 0;

fn set_hresult(hr: HRESULT) SpawnError {
    last_hresult = @bitCast(hr);
    return error.ConptyFailed;
}

/// HANDLE -> slot integer. HANDLEs are pointer-sized; the pool's slot is
/// c_int. Windows guarantees kernel handles are 32-bit significant even on
/// 64-bit (documented for USER and GDI handles, and KERNEL handles are
/// index-based), and the pool's negative error codes cannot collide because
/// valid handles have the top bit clear.
inline fn handle_to_fd(h: HANDLE) c_int {
    return @bitCast(@as(u32, @truncate(@intFromPtr(h))));
}

inline fn fd_to_handle(fd: c_int) HANDLE {
    return @ptrFromInt(@as(usize, @as(u32, @bitCast(fd))));
}

inline fn handle_from_aux(fd: i64) HANDLE {
    return @ptrFromInt(@as(usize, @bitCast(fd)));
}

/// Open a pseudo console, start `shell` attached to it, and return the
/// handles the pool needs.
pub fn spawn(
    shell: [*:0]const u8,
    cwd: ?[*:0]const u8,
    cols: u16,
    rows: u16,
) SpawnError!SpawnResult {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const shell_u16 = try std.unicode.utf8ToUtf16LeAlloc(alloc, std.mem.span(shell));
    const shell_w: [:0]u16 = try alloc.dupeZ(u16, shell_u16);
    const cwd_w: ?[*:0]const u16 = if (cwd) |c| blk: {
        const c_u16 = try std.unicode.utf8ToUtf16LeAlloc(alloc, std.mem.span(c));
        break :blk try alloc.dupeZ(u16, c_u16);
    } else null;

    // Pipe pair 1: we write -> ConPTY reads (terminal input). Keep our write
    // end non-inheritable so the conhost child does not hold it.
    var in_read: HANDLE = undefined;
    var in_write: HANDLE = undefined;
    if (CreatePipe(&in_read, &in_write, null, 0) == FALSE) return error.PipeFailed;
    _ = SetHandleInformation(in_write, HANDLE_FLAG_INHERIT, 0);

    // Pipe pair 2: ConPTY writes -> we read (terminal output).
    var out_read: HANDLE = undefined;
    var out_write: HANDLE = undefined;
    if (CreatePipe(&out_read, &out_write, null, 0) == FALSE) return error.PipeFailed;
    _ = SetHandleInformation(out_read, HANDLE_FLAG_INHERIT, 0);

    var hpcon: HPCON = undefined;
    const hr = CreatePseudoConsole(
        .{ .x = @intCast(cols), .y = @intCast(rows) },
        in_read,
        out_write,
        0,
        &hpcon,
    );
    if (hr != 0) return set_hresult(hr);

    // ConPTY duplicated its own references at creation; our ends are closed
    // only on failure. They stay open until destroy so ClosePseudoConsole
    // flushes correctly per Microsoft's ordering guidance.
    errdefer {
        ClosePseudoConsole(hpcon);
        _ = CloseHandle(in_read);
        _ = CloseHandle(in_write);
        _ = CloseHandle(out_read);
        _ = CloseHandle(out_write);
    }

    // Attribute list carrying the HPCON into CreateProcess.
    var attr_size: usize = 0;
    _ = InitializeProcThreadAttributeList(null, 1, 0, &attr_size);
    const attr_buf = try alloc.alignedAlloc(u8, .of(usize), attr_size);
    defer alloc.free(attr_buf);
    if (InitializeProcThreadAttributeList(attr_buf.ptr, 1, 0, &attr_size) == FALSE) {
        return error.AttrListInitFailed;
    }
    defer DeleteProcThreadAttributeList(attr_buf.ptr);

    if (UpdateProcThreadAttribute(
        attr_buf.ptr,
        0,
        PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
        hpcon,
        @sizeOf(HPCON),
        null,
        null,
    ) == FALSE) {
        return error.AttrUpdateFailed;
    }

    // STARTUPINFOEXW with the attribute list; cbStartupInfo must be the EX
    // size so kernel32 reads lpAttributeList.
    var si = std.mem.zeroes(STARTUPINFOEXW);
    si.StartupInfo.cb = @sizeOf(STARTUPINFOEXW);
    si.lpAttributeList = attr_buf.ptr;

    // Pass the command line through unquoted. Callers pass a full command
    // line (executable plus arguments); quoting the whole thing would make
    // CreateProcessW treat every word as part of the executable path and
    // fail with ERROR_FILE_NOT_FOUND. A caller spawning a path with spaces
    // must quote the executable itself.
    const cmd = shell_w;

    var pi: PROCESS_INFORMATION = std.mem.zeroes(PROCESS_INFORMATION);
    if (CreateProcessW(
        null,
        cmd.ptr,
        null,
        null,
        FALSE, // no handle inheritance; ConPTY is attached via the attribute
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
        null,
        cwd_w,
        &si,
        &pi,
    ) == FALSE) {
        last_errno = @intCast(GetLastError());
        return error.ProcessFailed;
    }
    _ = CloseHandle(pi.hThread);

    return .{
        .master_fd = handle_to_fd(out_read),
        .pid = handle_to_fd(pi.hProcess),
        .hpcon = hpcon,
        .in_write = in_write,
    };
}

/// Windows pipe reads are always pollable via peek; nothing to set.
pub fn setNonBlocking(fd: c_int) SetNonBlockingError!void {
    _ = fd;
}

/// Reads whatever is available from the output pipe. `fd` is the slot's
/// stored output read handle.
pub fn readOut(fd: c_int, buf: []u8) ReadOutcome {
    const h = fd_to_handle(fd);

    var avail: DWORD = 0;
    if (PeekNamedPipe(h, null, 0, null, &avail, null) == FALSE) {
        const err = GetLastError();
        // The ConPTY side closed: the session's output is done.
        if (err == ERROR_BROKEN_PIPE or err == ERROR_NO_DATA) return .eof;
        return .eof;
    }
    if (avail == 0) return .would_block;

    const want: DWORD = @intCast(@min(buf.len, @as(usize, avail)));
    var got: DWORD = 0;
    if (ReadFile(h, buf.ptr, want, &got, null) == FALSE) {
        const err = GetLastError();
        if (err == ERROR_BROKEN_PIPE or err == ERROR_NO_DATA) return .eof;
        return .eof;
    }
    if (got == 0) return .eof;
    return .{ .data = got };
}

/// Writes `data` to the aux (input) handle stored in slot.fd_aux.
pub fn writeInAux(aux_fd: c_int, data: []const u8) isize {
    return writeIn(aux_fd, data);
}

/// Writes `data` to the input pipe. Returns bytes written, 0 on transient
/// backpressure, or -1 on a hard error, mirroring pty_unix.writeIn.
pub fn writeIn(fd: c_int, data: []const u8) isize {
    if (data.len == 0) return 0;
    const h = fd_to_handle(fd);
    var written: DWORD = 0;
    if (WriteFile(h, data.ptr, @intCast(data.len), &written, null) == FALSE) {
        return -1;
    }
    return written;
}

/// Resizes the pseudo console identified by its HPCON (fd-encoded through
/// the slot's hpcon_aux field by main.zig).
pub fn resizeByHandle(hpcon_fd: i64, cols: u16, rows: u16) bool {
    const hpcon: HPCON = @ptrFromInt(@as(usize, @bitCast(hpcon_fd)));
    return ResizePseudoConsole(hpcon, .{ .x = @intCast(cols), .y = @intCast(rows) }) == 0;
}

/// Non-blocking reap. `pid` here is the child PROCESS handle.
pub fn reap(pid: c_int) ReapResult {
    const h = fd_to_handle(pid);
    const wait = WaitForSingleObject(h, 0);
    if (wait != 0) return .{ .reaped = false, .exit_code = -2 };

    var code: DWORD = 0;
    if (GetExitCodeProcess(h, &code) == FALSE) return .{ .reaped = true, .exit_code = -1 };
    // STILL_ACTIVE after a successful wait means the exit code collides with
    // the sentinel; reporting it as the raw value is still correct for the
    // caller because the process has exited.
    return .{ .reaped = true, .exit_code = @intCast(code) };
}

/// Closes the output read handle. Named closeFd to mirror pty_unix.
pub fn closeFd(fd: c_int) void {
    _ = CloseHandle(fd_to_handle(fd));
}

/// Closes the pseudo console, fd-encoded from the slot's hpcon_aux field.
/// Must be called before the pipe handles close so ConPTY's final output
/// flush is not lost (documented teardown ordering).
pub fn closeConpty(hpcon_fd: i64) void {
    const hpcon: HPCON = @ptrFromInt(@as(usize, @bitCast(hpcon_fd)));
    ClosePseudoConsole(hpcon);
}

/// Terminates the child. `pid` is the stored PROCESS handle.
pub fn terminate(pid: c_int) void {
    const h = fd_to_handle(pid);
    if (WaitForSingleObject(h, 0) != 0) {
        _ = TerminateProcess(h, 1);
    }
}

/// Absolute path a shell can be found at. PowerShell is the Windows shell
/// that actually honors ConPTY's VT stream; cmd.exe does too but with a
/// weaker feature set.
pub const default_shell: [*:0]const u8 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

// ---------------------------------------------------------------------------
// Tests (portable: no console spawned)
// ---------------------------------------------------------------------------

const testing = std.testing;

test "coord layout matches the C struct" {
    try testing.expectEqual(@as(usize, 4), @sizeOf(Coord));
}

test "handle round trip through slot integer" {
    const fake: HANDLE = @ptrFromInt(0x0042_0000);
    const fd = handle_to_fd(fake);
    try testing.expect(fd > 0);
    try testing.expectEqual(fake, fd_to_handle(fd));
}
