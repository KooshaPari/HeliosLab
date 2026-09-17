//! C ABI surface consumed by the Bun FFI bridge.
//!
//! Ownership model: one process-wide pool. `pty_pool_create` initialises it and
//! returns a pointer that must be passed back; the pointer is validated so a
//! stale handle cannot address a reinitialised pool.

const std = @import("std");
const builtin = @import("builtin");

const pool_mod = @import("pool.zig");
const ring_mod = @import("ring.zig");
const pty = @import("pty_unix.zig");

/// Maximum simultaneous PTYs. One slot per concurrent terminal session.
pub const CAPACITY: usize = 1024;

/// Per-session output buffer. 1024 slots x 16 KiB = 16 MiB fixed.
pub const RING_CAPACITY: usize = 16 * 1024;

/// Scratch buffer used to move bytes from the fd into the ring.
const PUMP_BUF: usize = 16 * 1024;

const Pool = pool_mod.Pool(CAPACITY);
const Ring = ring_mod.Ring(RING_CAPACITY);

/// Handle values, kept distinct from valid handles (which are >= 0).
pub const ERR_INVALID: i32 = -1;
pub const ERR_STALE: i32 = -2;
pub const ERR_IO: i32 = -3;
pub const ERR_SPAWN: i32 = -4;

/// Spawn sub-step failures, surfaced individually so a failing test names the
/// call that broke rather than reporting a single opaque ERR_SPAWN.
/// -10 openpt, -11 grantpt, -12 unlockpt, -13 slave open,
/// -14 winsize ioctl, -15 file actions, -16 spawn attributes, -17 posix_spawn.
pub const ERR_SPAWN_OPENPT: i32 = -10;
pub const ERR_SPAWN_GRANTPT: i32 = -11;
pub const ERR_SPAWN_UNLOCKPT: i32 = -12;
pub const ERR_SPAWN_SLAVE: i32 = -13;
pub const ERR_SPAWN_WINSIZE: i32 = -14;
pub const ERR_SPAWN_ACTIONS: i32 = -15;
pub const ERR_SPAWN_ATTR: i32 = -16;
pub const ERR_SPAWN_POSIX_SPAWN: i32 = -17;
pub const ERR_WOULD_BLOCK: i32 = -5;
pub const ERR_EOF: i32 = -6;
pub const ERR_EXHAUSTED: i32 = -7;
pub const ERR_NOT_INIT: i32 = -8;

var g_pool: Pool = undefined;
var g_rings: [CAPACITY]Ring = undefined;
var g_initialised: bool = false;

fn poolPtr() ?*Pool {
    return if (g_initialised) &g_pool else null;
}

fn mapError(e: anyerror) i32 {
    return switch (e) {
        error.PoolExhausted => ERR_EXHAUSTED,
        error.StaleHandle => ERR_STALE,
        else => ERR_INVALID,
    };
}

/// Initialise the process-wide pool. Returns 0 on success, an ERR_* otherwise.
/// Calling it again reinitialises, which invalidates every outstanding handle.
pub export fn pty_pool_create(max_pty: u32) i32 {
    if (max_pty == 0 or max_pty > CAPACITY) return ERR_INVALID;
    g_pool.init();
    for (&g_rings) |*r| r.clear();
    g_initialised = true;
    return 0;
}

/// Spawn a shell in a new PTY. Returns a handle, or a negative ERR_*.
pub export fn pty_pool_spawn(
    shell: [*:0]const u8,
    cwd: ?[*:0]const u8,
    cols: u16,
    rows: u16,
) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    if (cols == 0 or rows == 0) return ERR_INVALID;

    const handle = g_pool.acquire() catch |e| return mapError(e);
    const idx: usize = @intCast(handle & 0xFFFFF);
    g_rings[idx].clear();

    const res = pty.spawn(shell, cwd, cols, rows) catch |e| {
        g_pool.release(handle) catch {};
        // Distinct codes so a failing runtime test names the exact step.
        // Collapsing these to a single ERR_SPAWN made the failure
        // undiagnosable from the test output.
        return switch (e) {
            error.OpenptFailed => -10,
            error.GrantptFailed => -11,
            error.UnlockptFailed => -12,
            error.SlaveOpenFailed => -13,
            error.WinsizeFailed => -14,
            error.FileActionsFailed => -15,
            error.AttrFailed => -16,
            // Offset by the errno so the returned code identifies the cause.
            // posix_spawn returns the errno directly, so e.g. ENOENT (2) arrives
            // as -119 rather than an opaque -17.
            error.SpawnFailed => -100 - pty.last_errno,
        };
    };
    pty.setNonBlocking(res.master_fd) catch {};

    const slot = g_pool.get(handle) catch {
        pty.closeFd(res.master_fd);
        pty.terminate(res.pid);
        g_pool.release(handle) catch {};
        return ERR_STALE;
    };
    slot.fd = res.master_fd;
    slot.pid = res.pid;
    slot.cols = cols;
    slot.rows = rows;
    slot.state = .running;
    slot.exit_code = -2;
    return handle;
}

/// Read available bytes from the PTY fd into the slot's ring buffer.
/// Returns bytes buffered, 0 if nothing was ready, or a negative ERR_*.
pub export fn pty_pool_pump(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;

    const slot = g_pool.get(handle) catch |e| return mapError(e);
    if (slot.fd < 0) return ERR_INVALID;

    const idx: usize = @intCast(handle & 0xFFFFF);
    var buf: [PUMP_BUF]u8 = undefined;

    var total: i32 = 0;
    // Drain until the fd would block or the ring fills (backpressure).
    while (g_rings[idx].writable() > 0) {
        const room = @min(g_rings[idx].writable(), PUMP_BUF);
        switch (pty.readOut(slot.fd, buf[0..room])) {
            .data => |n| {
                const wrote = g_rings[idx].write(buf[0..n]);
                total += @intCast(wrote);
                if (wrote < n) break; // ring full; stop and let the caller drain
                if (n < room) break;
            },
            .would_block => break,
            .eof => {
                // Keep the status. Discarding it here marked the slot exited
                // while leaving exit_code at -2, and the child unreaped.
                const r = pty.reap(slot.pid);
                if (r.reaped and slot.exit_code == -2) slot.exit_code = r.exit_code;
                slot.state = .exited;
                return total;
            },
        }
    }
    return total;
}

/// Drain buffered bytes out of the ring into `out`.
pub export fn pty_pool_read(handle: i32, out: [*]u8, out_len: u32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    _ = g_pool.get(handle) catch |e| return mapError(e);
    if (out_len == 0) return 0;

    const idx: usize = @intCast(handle & 0xFFFFF);
    return @intCast(g_rings[idx].read(out[0..out_len]));
}

/// Bytes currently buffered for this session.
pub export fn pty_pool_readable(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    _ = g_pool.get(handle) catch |e| return mapError(e);
    const idx: usize = @intCast(handle & 0xFFFFF);
    return @intCast(g_rings[idx].readable());
}

/// Send input to the child. Returns bytes written, or a negative ERR_*.
pub export fn pty_pool_write(handle: i32, data: [*]const u8, len: u32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;

    const slot = g_pool.get(handle) catch |e| return mapError(e);
    if (slot.fd < 0) return ERR_INVALID;
    if (len == 0) return 0;

    const n = pty.writeIn(slot.fd, data[0..len]);
    if (n < 0) {
        slot.state = .errored;
        return ERR_IO;
    }
    return @intCast(n);
}

/// Resize the PTY window. Returns 0 on success, a negative ERR_* otherwise.
pub export fn pty_pool_resize(handle: i32, cols: u16, rows: u16) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    if (cols == 0 or rows == 0) return ERR_INVALID;

    const slot = g_pool.get(handle) catch |e| return mapError(e);
    if (slot.fd < 0) return ERR_INVALID;

    if (!pty.resize(slot.fd, cols, rows)) return ERR_IO;
    slot.cols = cols;
    slot.rows = rows;
    return 0;
}

/// Lifecycle state: 0 closed, 1 running, 2 exited, 3 errored.
pub export fn pty_pool_state(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    const slot = g_pool.get(handle) catch |e| return mapError(e);
    return @intFromEnum(slot.state);
}

/// Child exit code. -2 means "not reaped yet"; signals are reported negative.
pub export fn pty_pool_exit_code(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    const slot = g_pool.get(handle) catch |e| return mapError(e);
    return slot.exit_code;
}

/// Non-blocking reap; updates state and exit code when the child has finished.
pub export fn pty_pool_reap(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    const slot = g_pool.get(handle) catch |e| return mapError(e);
    // Skip only when the status is already known. Keying off the slot state
    // instead meant that once pump saw EOF and marked the slot exited, reap
    // refused to run and the exit status was lost permanently, leaving a
    // zombie behind.
    if (slot.exit_code != -2) return 0;

    const r = pty.reap(slot.pid);
    if (!r.reaped) return 0;
    slot.exit_code = r.exit_code;
    slot.state = .exited;
    return 1;
}

/// Terminate and release one session.
pub export fn pty_pool_destroy(handle: i32) i32 {
    if (!g_initialised) return ERR_NOT_INIT;

    const slot = g_pool.get(handle) catch |e| return mapError(e);
    if (slot.state == .running) {
        pty.terminate(slot.pid);
        _ = pty.reap(slot.pid);
    }
    if (slot.fd >= 0) pty.closeFd(slot.fd);

    const idx: usize = @intCast(handle & 0xFFFFF);
    g_rings[idx].clear();
    g_pool.release(handle) catch |e| return mapError(e);
    return 0;
}

/// Terminate and release every session.
pub export fn pty_pool_destroy_all() void {
    if (!g_initialised) return;

    var views: [CAPACITY]pool_mod.SlotView = undefined;
    const n = g_pool.snapshot(&views);
    for (views[0..n]) |v| {
        const handle: i32 = @intCast((g_pool.slots[v.index].generation << 20) | v.index);
        _ = pty_pool_destroy(handle);
    }
}

/// Number of live sessions.
pub export fn pty_pool_live_count() i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    return @intCast(g_pool.liveCount());
}

/// Slots still available.
pub export fn pty_pool_available() i32 {
    if (!g_initialised) return ERR_NOT_INIT;
    return @intCast(g_pool.available());
}

/// Build metadata, so the bridge can assert it loaded a compatible library.
pub export fn pty_pool_abi_version() u32 {
    return 2;
}
