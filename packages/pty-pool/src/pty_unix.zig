//! POSIX pseudo-terminal backend (macOS).
//!
//! Deliberately avoids `@cImport`. On macOS that drags in the mach headers,
//! whose static assertions Zig 0.16's translator cannot satisfy, producing
//! errors in generated code that have nothing to do with this file. The
//! handful of libc entry points used here are declared explicitly instead.
//!
//! Every constant below was read from the target's own headers rather than
//! written from memory. Where a header derives a value from a struct size, the
//! same expression is reproduced here so Zig evaluates it at comptime, because
//! the C preprocessor leaves `sizeof` unevaluated and hand-computing it is
//! exactly the kind of guess that compiles and then misbehaves.
//!
//! `posix_spawn` is used rather than `fork` + `exec`: the library runs inside a
//! threaded JavaScript runtime, and `fork` in a multithreaded process can
//! deadlock if the child touches a lock its parent held.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag == .windows) {
        @compileError("pty_unix.zig is POSIX-only; guard imports with builtin.os.tag");
    }
    // The constants below encode macOS's ioctl layout, so this file is
    // macOS-specific until the Linux values are added.
    if (builtin.os.tag != .macos) {
        @compileError("pty_unix.zig currently targets macOS only");
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// `struct winsize`, from <sys/ioctl.h>: four unsigned shorts.
pub const Winsize = extern struct {
    ws_row: c_ushort = 0,
    ws_col: c_ushort = 0,
    ws_xpixel: c_ushort = 0,
    ws_ypixel: c_ushort = 0,
};

/// Both of these are `typedef void *` in macOS <spawn.h> (lines 51-52), so
/// there is no structure layout to reproduce.
const posix_spawn_file_actions_t = ?*anyopaque;
const posix_spawnattr_t = ?*anyopaque;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// Confirmed by `cc -E -P` on the target, not by reading or by arithmetic.

const O_RDWR: c_int = 0x0002;
const O_NOCTTY: c_int = 0x00020000;
const O_NONBLOCK: c_int = 0x00000004;

const F_GETFL: c_int = 3;
const F_SETFL: c_int = 4;

const EAGAIN: c_int = 35;
const EWOULDBLOCK: c_int = 35;
const EINTR: c_int = 4;

const SIGHUP: c_int = 1;
const WNOHANG: c_int = 1;

/// <spawn.h>: the only attribute flag needed here.
const POSIX_SPAWN_SETSID: c_short = 0x0400;

// <sys/ttycom.h> defines these as expressions, not literals:
//   TIOCSWINSZ = _IOW('t', 103, struct winsize)
//   TIOCSCTTY  = _IO('t', 97)
// The preprocessor leaves sizeof unevaluated, so the expression is reproduced
// and @sizeOf is resolved by Zig.
const IOC_IN: c_ulong = 0x80000000;
const IOC_VOID: c_ulong = 0x20000000;
const TIOCSWINSZ: c_ulong = IOC_IN |
    ((@as(c_ulong, @sizeOf(Winsize)) & 0x1fff) << 16) |
    (@as(c_ulong, 't') << 8) | 103;
const TIOCSCTTY: c_ulong = IOC_VOID | (@as(c_ulong, 't') << 8) | 97;

// ---------------------------------------------------------------------------
// libc declarations
// ---------------------------------------------------------------------------

extern "c" fn posix_openpt(oflag: c_int) c_int;
extern "c" fn grantpt(fd: c_int) c_int;
extern "c" fn unlockpt(fd: c_int) c_int;
extern "c" fn ptsname(fd: c_int) ?[*:0]u8;
extern "c" fn open(path: [*:0]const u8, oflag: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, nbyte: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, nbyte: usize) isize;
extern "c" fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;
extern "c" fn kill(pid: c_int, sig: c_int) c_int;
extern "c" fn waitpid(pid: c_int, status: *c_int, options: c_int) c_int;
/// macOS spells errno's accessor `__error`, not `__errno_location`.
extern "c" fn __error() *c_int;

extern "c" fn posix_spawn(
    pid: *c_int,
    path: [*:0]const u8,
    file_actions: *const posix_spawn_file_actions_t,
    attrp: *const posix_spawnattr_t,
    argv: [*:null]const ?[*:0]const u8,
    envp: [*:null]const ?[*:0]const u8,
) c_int;

extern "c" fn posix_spawn_file_actions_init(actions: *posix_spawn_file_actions_t) c_int;
extern "c" fn posix_spawn_file_actions_destroy(actions: *posix_spawn_file_actions_t) c_int;
extern "c" fn posix_spawn_file_actions_adddup2(actions: *posix_spawn_file_actions_t, fd: c_int, newfd: c_int) c_int;
extern "c" fn posix_spawn_file_actions_addclose(actions: *posix_spawn_file_actions_t, fd: c_int) c_int;
extern "c" fn posix_spawn_file_actions_addchdir_np(actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int;

extern "c" fn posix_spawnattr_init(attr: *posix_spawnattr_t) c_int;
extern "c" fn posix_spawnattr_destroy(attr: *posix_spawnattr_t) c_int;
extern "c" fn posix_spawnattr_getflags(attr: *const posix_spawnattr_t, flags: *c_short) c_int;
extern "c" fn posix_spawnattr_setflags(attr: *posix_spawnattr_t, flags: c_short) c_int;

extern "c" var environ: [*:null]const ?[*:0]const u8;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

pub const SpawnError = error{
    OpenptFailed,
    GrantptFailed,
    UnlockptFailed,
    SlaveOpenFailed,
    WinsizeFailed,
    FileActionsFailed,
    AttrFailed,
    SpawnFailed,
};

pub const SetNonBlockingError = error{SetNonBlockingFailed};

pub const SpawnResult = struct {
    master_fd: c_int,
    pid: c_int,
};

pub const ReadOutcome = union(enum) {
    /// `n` bytes were written into the caller's buffer.
    data: usize,
    /// Nothing available now; retry later.
    would_block,
    /// The slave side is gone.
    eof,
};

pub const ReapResult = struct {
    reaped: bool,
    exit_code: c_int,
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// Open a PTY, start `shell` attached to it, and return the master fd.
pub fn spawn(
    shell: [*:0]const u8,
    cwd: ?[*:0]const u8,
    cols: u16,
    rows: u16,
) SpawnError!SpawnResult {
    const master = posix_openpt(O_RDWR | O_NOCTTY);
    if (master < 0) return error.OpenptFailed;
    errdefer _ = close(master);

    if (grantpt(master) != 0) return error.GrantptFailed;
    if (unlockpt(master) != 0) return error.UnlockptFailed;

    const slave_name = ptsname(master) orelse return error.SlaveOpenFailed;

    var ws = Winsize{ .ws_row = rows, .ws_col = cols };
    if (ioctl(master, TIOCSWINSZ, &ws) != 0) return error.WinsizeFailed;

    // Open the slave up front so the spawn actions only need dup2.
    const slave = open(slave_name, O_RDWR | O_NOCTTY);
    if (slave < 0) return error.SlaveOpenFailed;
    defer _ = close(slave);

    var actions: posix_spawn_file_actions_t = null;
    if (posix_spawn_file_actions_init(&actions) != 0) return error.FileActionsFailed;
    defer _ = posix_spawn_file_actions_destroy(&actions);

    if (posix_spawn_file_actions_adddup2(&actions, slave, 0) != 0) return error.FileActionsFailed;
    if (posix_spawn_file_actions_adddup2(&actions, slave, 1) != 0) return error.FileActionsFailed;
    if (posix_spawn_file_actions_adddup2(&actions, slave, 2) != 0) return error.FileActionsFailed;
    if (cwd) |dir| {
        if (posix_spawn_file_actions_addchdir_np(&actions, dir) != 0) return error.FileActionsFailed;
    }
    if (posix_spawn_file_actions_addclose(&actions, master) != 0) return error.FileActionsFailed;

    var attr: posix_spawnattr_t = null;
    if (posix_spawnattr_init(&attr) != 0) return error.AttrFailed;
    defer _ = posix_spawnattr_destroy(&attr);

    // Put the child in its own session so the PTY becomes its controlling
    // terminal. Without this, job control and Ctrl-C misbehave.
    var flags: c_short = 0;
    _ = posix_spawnattr_getflags(&attr, &flags);
    if (posix_spawnattr_setflags(&attr, flags | POSIX_SPAWN_SETSID) != 0) return error.AttrFailed;

    const argv = [_:null]?[*:0]const u8{ shell, null };
    var pid: c_int = 0;
    if (posix_spawn(&pid, shell, &actions, &attr, &argv, environ) != 0) {
        return error.SpawnFailed;
    }

    return .{ .master_fd = master, .pid = pid };
}

/// Switch the master fd to non-blocking so reads can be polled.
pub fn setNonBlocking(fd: c_int) SetNonBlockingError!void {
    const flags = fcntl(fd, F_GETFL);
    if (flags < 0) return error.SetNonBlockingFailed;
    if (fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return error.SetNonBlockingFailed;
}

/// Reads into `buf`. Named `readOut` because the libc `read` declared above
/// occupies the plain name.
pub fn readOut(fd: c_int, buf: []u8) ReadOutcome {
    const n = read(fd, buf.ptr, buf.len);
    if (n > 0) return .{ .data = @intCast(n) };
    if (n == 0) return .eof;

    const err = __error().*;
    if (err == EAGAIN or err == EWOULDBLOCK or err == EINTR) return .would_block;
    return .eof;
}

/// Writes `data`. Named `writeIn` for the same reason as `readOut`.
pub fn writeIn(fd: c_int, data: []const u8) isize {
    if (data.len == 0) return 0;
    const n = write(fd, data.ptr, data.len);
    if (n < 0) {
        const err = __error().*;
        if (err == EAGAIN or err == EWOULDBLOCK or err == EINTR) return 0;
        return -1;
    }
    return n;
}

pub fn resize(fd: c_int, cols: u16, rows: u16) bool {
    var ws = Winsize{ .ws_row = rows, .ws_col = cols };
    return ioctl(fd, TIOCSWINSZ, &ws) == 0;
}

/// Non-blocking reap of the child.
pub fn reap(pid: c_int) ReapResult {
    var status: c_int = 0;
    const r = waitpid(pid, &status, WNOHANG);
    if (r <= 0) return .{ .reaped = false, .exit_code = -2 };

    if (wIfExited(status)) return .{ .reaped = true, .exit_code = wExitStatus(status) };
    if (wIfSignaled(status)) {
        // Signals are reported negative, matching shell conventions.
        return .{ .reaped = true, .exit_code = -wTermSig(status) };
    }
    return .{ .reaped = false, .exit_code = -2 };
}

/// Closes a descriptor. Named `closeFd` because libc `close` is declared above.
pub fn closeFd(fd: c_int) void {
    _ = close(fd);
}

pub fn terminate(pid: c_int) void {
    if (pid > 0) _ = kill(pid, SIGHUP);
}

// The wait-status accessors are macros in <sys/wait.h>, reproduced here.
inline fn wIfExited(status: c_int) bool {
    return (status & 0x7f) == 0;
}
inline fn wExitStatus(status: c_int) c_int {
    return (status >> 8) & 0xff;
}
inline fn wIfSignaled(status: c_int) bool {
    const low = status & 0x7f;
    return low > 0 and low != 0x7f;
}
inline fn wTermSig(status: c_int) c_int {
    return status & 0x7f;
}

/// Absolute path a shell can be found at.
pub const default_shell: [*:0]const u8 = "/bin/zsh";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const testing = std.testing;

test "winsize layout matches the C struct" {
    // Four unsigned shorts. TIOCSWINSZ depends on this via @sizeOf, so a wrong
    // size silently changes the ioctl request number.
    try testing.expectEqual(@as(usize, 8), @sizeOf(Winsize));
}

test "ioctl request numbers match the C macros" {
    // Computed the same way _IOW/_IO do, with @sizeOf resolved by Zig.
    try testing.expectEqual(@as(c_ulong, 0x80087467), TIOCSWINSZ);
    try testing.expectEqual(@as(c_ulong, 0x20007461), TIOCSCTTY);
}

test "wait status accessors" {
    // exit(42) as encoded by the kernel: status 42 << 8.
    try testing.expect(wIfExited(42 << 8));
    try testing.expectEqual(@as(c_int, 42), wExitStatus(42 << 8));
    try testing.expect(!wIfSignaled(42 << 8));

    // killed by signal 9: low bits hold the signal.
    try testing.expect(wIfSignaled(9));
    try testing.expectEqual(@as(c_int, 9), wTermSig(9));
    try testing.expect(!wIfExited(9));

    // A stopped child is neither exited nor signalled-terminated.
    try testing.expect(!wIfExited(0x7f));
    try testing.expect(!wIfSignaled(0x7f));
}
