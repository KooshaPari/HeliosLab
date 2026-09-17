//! Runtime verification against a real PTY.
//!
//! Separate from `core_test.zig`, which covers the allocation-free core and runs
//! anywhere. This file actually spawns a shell, so it needs a POSIX host.
//!
//!   zig test src/pty_runtime_test.zig -lc
//!
//! Compiling proves the extern declarations typecheck. It does not prove an
//! ioctl request number or a spawn attribute is right, and a wrong ioctl fails
//! silently. So this drives real bytes through the real ABI and reads the
//! shell's own report back.

const std = @import("std");
const testing = std.testing;
const pool = @import("main.zig");

const POPEN_SHELL = "/bin/sh";

/// Zig 0.16 moved `sleep` behind the `Io` interface, so call libc directly
/// rather than threading an Io instance through the tests.
const Timespec = extern struct {
    sec: isize,
    nsec: isize,
};
extern "c" fn nanosleep(rqtp: *const Timespec, rmtp: ?*Timespec) c_int;

/// Brief pause so the shell has time to produce output.
fn pause() void {
    var ts = Timespec{ .sec = 0, .nsec = 5 * std.time.ns_per_ms };
    _ = nanosleep(&ts, null);
}

/// Write a command, then poll for `needle` in the output.
///
/// Returns true if the needle appeared. Drains on every iteration because the
/// ring buffer provides backpressure and stops accepting once full.
fn runAndExpect(handle: i32, command: []const u8, needle: []const u8) !bool {
    const written = pool.pty_pool_write(handle, command.ptr, @intCast(command.len));
    if (written < 0) return error.WriteFailed;

    var buf: [8192]u8 = undefined;
    var seen = false;
    var attempts: usize = 0;

    while (attempts < 400 and !seen) : (attempts += 1) {
        _ = pool.pty_pool_pump(handle);
        const got = pool.pty_pool_read(handle, &buf, @intCast(buf.len));
        if (got > 0) {
            if (std.mem.indexOf(u8, buf[0..@intCast(got)], needle) != null) seen = true;
        } else {
            pause();
        }
    }
    return seen;
}

test "spawns a real shell and reads its output" {
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_create(8));

    const handle = pool.pty_pool_spawn(POPEN_SHELL, null, 80, 24);
    try testing.expect(handle >= 0);
    defer _ = pool.pty_pool_destroy(handle);

    // Proves openpt/grantpt/unlockpt/ptsname and the dup2 file actions all
    // worked: nothing else can produce this line.
    const seen = try runAndExpect(handle, "echo HELIOS_PTY_OK\n", "HELIOS_PTY_OK");
    try testing.expect(seen);
}

test "resize actually reaches the kernel" {
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_create(8));

    const handle = pool.pty_pool_spawn(POPEN_SHELL, null, 80, 24);
    try testing.expect(handle >= 0);
    defer _ = pool.pty_pool_destroy(handle);

    // Confirms the shell is running before resizing.
    try testing.expect(try runAndExpect(handle, "echo READY\n", "READY"));

    try testing.expectEqual(@as(i32, 0), pool.pty_pool_resize(handle, 120, 40));

    // The shell reports the window size *it* believes it has, which comes from
    // the kernel, which got it from TIOCSWINSZ. If that request number were
    // wrong the ioctl silently does nothing and this prints the old 24 80.
    const seen = try runAndExpect(handle, "stty size\n", "40 120");
    try testing.expect(seen);
}

test "child exit is reported through the lifecycle API" {
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_create(8));

    const handle = pool.pty_pool_spawn(POPEN_SHELL, null, 80, 24);
    try testing.expect(handle >= 0);
    defer _ = pool.pty_pool_destroy(handle);

    _ = pool.pty_pool_write(handle, "exit 7\n", 7);

    // Wait for the child to die, then confirm the status is visible.
    var attempts: usize = 0;
    var reaped = false;
    while (attempts < 400 and !reaped) : (attempts += 1) {
        _ = pool.pty_pool_pump(handle);
        if (pool.pty_pool_reap(handle) == 1) reaped = true;
        pause();
    }

    try testing.expect(reaped);
    try testing.expectEqual(@as(i32, 7), pool.pty_pool_exit_code(handle));
    try testing.expectEqual(@as(i32, 2), pool.pty_pool_state(handle)); // exited
}

test "pool accounting reflects real sessions" {
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_create(8));
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_live_count());

    const handle = pool.pty_pool_spawn(POPEN_SHELL, null, 80, 24);
    try testing.expect(handle >= 0);
    try testing.expectEqual(@as(i32, 1), pool.pty_pool_live_count());

    try testing.expectEqual(@as(i32, 0), pool.pty_pool_destroy(handle));
    try testing.expectEqual(@as(i32, 0), pool.pty_pool_live_count());
}
