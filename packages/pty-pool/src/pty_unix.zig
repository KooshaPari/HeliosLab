//! POSIX pseudo-terminal backend.
//!
//! Only compiled on macOS and Linux. The child is started with `posix_spawn`
//! rather than `fork` + `exec`: the library runs inside a threaded JavaScript
//! runtime, and `fork` in a multithreaded process can deadlock if the child
//! touches a lock its parent held at fork time.

const std = @import("std");
const builtin = @import("builtin");

comptime {
    if (builtin.os.tag == .windows) {
        @compileError("pty_unix.zig is POSIX-only; guard imports with builtin.os.tag");
    }
}

const c = @cImport({
    @cDefine("_DARWIN_C_SOURCE", "1");
    @cDefine("_GNU_SOURCE", "1");
    @cInclude("stdlib.h");
    @cInclude("fcntl.h");
    @cInclude("unistd.h");
    @cInclude("errno.h");
    @cInclude("signal.h");
    @cInclude("spawn.h");
    @cInclude("sys/ioctl.h");
    @cInclude("sys/types.h");
    @cInclude("sys/wait.h");
});

pub const SpawnResult = struct {
    master_fd: i32,
    pid: i32,
};

pub const SpawnError = error{
    OpenptFailed,
    GrantptFailed,
    UnlockptFailed,
    SlaveOpenFailed,
    WinsizeFailed,
    SpawnFailed,
};

pub const ReadOutcome = union(enum) {
    /// `n` bytes were written into the caller's buffer.
    data: usize,
    /// No data right now; try again later (EAGAIN/EWOULDBLOCK).
    would_block,
    /// The slave side is gone; the child has exited or is exiting.
    eof,
};

/// Exit code and whether the child has been reaped this call.
pub const ReapResult = struct {
    reaped: bool,
    exit_code: i32,
};

/// Open a PTY, start `shell` attached to it, and return the master fd.
///
/// `cwd` may be null to inherit the parent's working directory.
pub fn spawn(
    shell: [*:0]const u8,
    cwd: ?[*:0]const u8,
    cols: u16,
    rows: u16,
) SpawnError!SpawnResult {
    const master = c.posix_openpt(c.O_RDWR | c.O_NOCTTY);
    if (master < 0) return error.OpenptFailed;
    errdefer _ = c.close(master);

    if (c.grantpt(master) != 0) return error.GrantptFailed;
    if (c.unlockpt(master) != 0) return error.UnlockptFailed;

    const slave_name = c.ptsname(master) orelse return error.SlaveOpenFailed;

    var ws: c.struct_winsize = .{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    if (c.ioctl(master, c.TIOCSWINSZ, &ws) != 0) return error.WinsizeFailed;

    // Open the slave up front so the spawn file actions only need dup2.
    const slave = c.open(slave_name, c.O_RDWR | c.O_NOCTTY);
    if (slave < 0) return error.SlaveOpenFailed;
    defer _ = c.close(slave);

    var actions: c.posix_spawn_file_actions_t = undefined;
    if (c.posix_spawn_file_actions_init(&actions) != 0) return error.SpawnFailed;
    defer c.posix_spawn_file_actions_destroy(&actions);

    if (c.posix_spawn_file_actions_adddup2(&actions, slave, 0) != 0) return error.SpawnFailed;
    if (c.posix_spawn_file_actions_adddup2(&actions, slave, 1) != 0) return error.SpawnFailed;
    if (c.posix_spawn_file_actions_adddup2(&actions, slave, 2) != 0) return error.SpawnFailed;
    if (cwd) |dir| {
        if (c.posix_spawn_file_actions_addchdir_np(&actions, dir) != 0) return error.SpawnFailed;
    }
    if (c.posix_spawn_file_actions_addclose(&actions, master) != 0) return error.SpawnFailed;

    var attr: c.posix_spawnattr_t = undefined;
    if (c.posix_spawnattr_init(&attr) != 0) return error.SpawnFailed;
    defer c.posix_spawnattr_destroy(&attr);

    // Put the child in its own session so the PTY becomes its controlling
    // terminal. Without this, job control and Ctrl-C handling misbehave.
    var flags: c_short = 0;
    _ = c.posix_spawnattr_getflags(&attr, &flags);
    if (c.posix_spawnattr_setflags(&attr, flags | c.POSIX_SPAWN_SETSID) != 0) {
        return error.SpawnFailed;
    }

    var argv = [_:null]?[*:0]const u8{ shell, null };
    var pid: c.pid_t = 0;
    const rc = c.posix_spawn(&pid, shell, &actions, &attr, @ptrCast(&argv), c.environ);
    if (rc != 0) return error.SpawnFailed;

    return .{ .master_fd = @intCast(master), .pid = @intCast(pid) };
}

/// Switch the master fd to non-blocking so reads can be polled.
pub fn setNonBlocking(fd: i32) !void {
    const flags = c.fcntl(fd, c.F_GETFL);
    if (flags < 0) return error.SetNonBlockingFailed;
    if (c.fcntl(fd, c.F_SETFL, flags | c.O_NONBLOCK) < 0) {
        return error.SetNonBlockingFailed;
    }
}

pub fn read(fd: i32, buf: []u8) ReadOutcome {
    const n = c.read(fd, buf.ptr, buf.len);
    if (n > 0) return .{ .data = @intCast(n) };
    if (n == 0) return .eof;

    const err = std.c._errno().*;
    if (err == c.EAGAIN or err == c.EWOULDBLOCK) return .would_block;
    if (err == c.EINTR) return .would_block;
    return .eof;
}

pub fn write(fd: i32, data: []const u8) isize {
    if (data.len == 0) return 0;
    const n = c.write(fd, data.ptr, data.len);
    if (n < 0) {
        const err = std.c._errno().*;
        if (err == c.EAGAIN or err == c.EWOULDBLOCK or err == c.EINTR) return 0;
        return -1;
    }
    return @intCast(n);
}

pub fn resize(fd: i32, cols: u16, rows: u16) bool {
    var ws: c.struct_winsize = .{
        .ws_row = rows,
        .ws_col = cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    return c.ioctl(fd, c.TIOCSWINSZ, &ws) == 0;
}

/// Non-blocking reap of the child.
pub fn reap(pid: i32) ReapResult {
    var status: c_int = 0;
    const r = c.waitpid(pid, &status, c.WNOHANG);
    if (r <= 0) return .{ .reaped = false, .exit_code = -2 };

    if (c.WIFEXITED(status)) return .{ .reaped = true, .exit_code = c.WEXITSTATUS(status) };
    if (c.WIFSIGNALED(status)) {
        // Report signals as negative values, matching shell conventions.
        return .{ .reaped = true, .exit_code = -c.WTERMSIG(status) };
    }
    return .{ .reaped = false, .exit_code = -2 };
}

pub fn close(fd: i32) void {
    _ = c.close(fd);
}

pub fn terminate(pid: i32) void {
    if (pid > 0) _ = c.kill(pid, c.SIGHUP);
}

/// Absolute path a shell can be found at, in preference order.
pub const default_shell = if (builtin.os.tag == .macos) "/bin/zsh" else "/bin/bash";
