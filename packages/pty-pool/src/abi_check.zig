//! Drives the built dylib through dynamic loading, the way the Bun FFI bridge
//! will.
//!
//! `zig test` exercises the ABI by linking directly, which resolves symbols at
//! link time. That is not how the bridge reaches them: it calls `dlopen` and
//! then looks each symbol up by name at runtime. This program does the same,
//! so it fails if a symbol is missing from the export table, or if a signature
//! declared in TypeScript does not match what the library actually implements.
//!
//!   zig run src/abi_check.zig -- <path-to-dylib>

const std = @import("std");

// Signatures copied from PTY_SYMBOLS in the TypeScript bridge, so a mismatch
// here is a mismatch there.
//
// callconv(.c) is required. A bare `*const fn` defaults to Zig's .auto, and
// calling a C function through it produced a plausible-looking pointer that
// then misbehaved on the first call with arguments. Symbol lookup succeeding
// says nothing about the calling convention being right.
const FnCreate = *const fn (u32) callconv(.c) i32;
const FnSpawn = *const fn ([*:0]const u8, ?[*:0]const u8, u16, u16) callconv(.c) i32;
const FnPump = *const fn (i32) callconv(.c) i32;
const FnRead = *const fn (i32, [*]u8, u32) callconv(.c) i32;
const FnWrite = *const fn (i32, [*]const u8, u32) callconv(.c) i32;
const FnResize = *const fn (i32, u16, u16) callconv(.c) i32;
const FnState = *const fn (i32) callconv(.c) i32;
const FnDestroy = *const fn (i32) callconv(.c) i32;
const FnLive = *const fn () callconv(.c) i32;
const FnAbi = *const fn () callconv(.c) u32;

pub fn main() !void {
    // Fixed rather than read from argv: Zig 0.16 moved the argument API, and
    // this program only ever runs from the package directory.
    const path = "zig-out/lib/libhelios-pty.dylib";

    var lib = std.DynLib.open(path) catch |e| {
        std.debug.print("FAIL: cannot dlopen {s}: {t}\n", .{ path, e });
        return error.DlopenFailed;
    };
    defer lib.close();
    std.debug.print("dlopen ok: {s}\n", .{path});

    // Every symbol the bridge binds. A missing one here means the bridge would
    // throw a missing-symbol error at load time.
    var missing: usize = 0;
    const create = lib.lookup(FnCreate, "pty_pool_create") orelse blk: {
        std.debug.print("MISSING pty_pool_create\n", .{});
        missing += 1;
        break :blk null;
    };
    const spawn = lib.lookup(FnSpawn, "pty_pool_spawn") orelse blk: {
        std.debug.print("MISSING pty_pool_spawn\n", .{});
        missing += 1;
        break :blk null;
    };
    const pump = lib.lookup(FnPump, "pty_pool_pump") orelse blk: {
        std.debug.print("MISSING pty_pool_pump\n", .{});
        missing += 1;
        break :blk null;
    };
    const read = lib.lookup(FnRead, "pty_pool_read") orelse blk: {
        std.debug.print("MISSING pty_pool_read\n", .{});
        missing += 1;
        break :blk null;
    };
    const write = lib.lookup(FnWrite, "pty_pool_write") orelse blk: {
        std.debug.print("MISSING pty_pool_write\n", .{});
        missing += 1;
        break :blk null;
    };
    const resize = lib.lookup(FnResize, "pty_pool_resize") orelse blk: {
        std.debug.print("MISSING pty_pool_resize\n", .{});
        missing += 1;
        break :blk null;
    };
    const state = lib.lookup(FnState, "pty_pool_state") orelse blk: {
        std.debug.print("MISSING pty_pool_state\n", .{});
        missing += 1;
        break :blk null;
    };
    const destroy = lib.lookup(FnDestroy, "pty_pool_destroy") orelse blk: {
        std.debug.print("MISSING pty_pool_destroy\n", .{});
        missing += 1;
        break :blk null;
    };
    const live = lib.lookup(FnLive, "pty_pool_live_count") orelse blk: {
        std.debug.print("MISSING pty_pool_live_count\n", .{});
        missing += 1;
        break :blk null;
    };
    const abi = lib.lookup(FnAbi, "pty_pool_abi_version") orelse blk: {
        std.debug.print("MISSING pty_pool_abi_version\n", .{});
        missing += 1;
        break :blk null;
    };

    if (missing != 0) {
        std.debug.print("FAIL: {d} symbol(s) missing\n", .{missing});
        return error.MissingSymbols;
    }
    std.debug.print("all symbols resolved at runtime\n", .{});

    // The ABI version the bridge compares against before using anything else.
    const version = abi.?();
    std.debug.print("abi_version = {d} (bridge expects 2)\n", .{version});
    if (version != 2) return error.AbiMismatch;

    // Drive a real session through the pointers, as the bridge would. The `.?`
    // is safe: every lookup above was checked for null.
    if (create.?(8) != 0) return error.CreateFailed;
    const handle = spawn.?("/bin/sh", null, 100, 30);
    if (handle < 0) {
        std.debug.print("FAIL: spawn returned {d}\n", .{handle});
        return error.SpawnFailed;
    }
    std.debug.print("spawn ok: handle={d} live={d}\n", .{ handle, live.?() });

    const cmd = "echo DYNLIB_OK\n";
    if (write.?(handle, cmd.ptr, cmd.len) < 0) return error.WriteFailed;
    if (resize.?(handle, 120, 40) != 0) {
        std.debug.print("FAIL: resize\n", .{});
        return error.ResizeFailed;
    }

    var buf: [4096]u8 = undefined;
    var seen = false;
    var attempts: usize = 0;
    while (attempts < 300 and !seen) : (attempts += 1) {
        _ = pump.?(handle);
        const n = read.?(handle, &buf, buf.len);
        if (n > 0 and std.mem.indexOf(u8, buf[0..@intCast(n)], "DYNLIB_OK") != null) seen = true;
    }
    if (!seen) {
        std.debug.print("FAIL: never saw DYNLIB_OK from the shell\n", .{});
        return error.NoOutput;
    }
    std.debug.print("shell output observed through the dlopen'd ABI\n", .{});

    if (destroy.?(handle) != 0) return error.DestroyFailed;
    std.debug.print("destroy ok: live={d} state={d}\n", .{ live.?(), state.?(handle) });
    std.debug.print("\nPASS: the C ABI works through dynamic loading\n", .{});
}
