//! Slot bookkeeping for the PTY pool.
//!
//! The pool owns no operating-system resources; `pty_unix.zig` does that. This
//! module is pure state so it can be tested on any host.
//!
//! Handles are generation-tagged: a handle issued for a slot that has since
//! been recycled will not resolve, which turns a use-after-free into a clean
//! "stale handle" error instead of writing to a stranger's terminal.

const std = @import("std");
const testing = std.testing;

pub const SlotState = enum(u8) {
    closed = 0,
    running = 1,
    exited = 2,
    errored = 3,
};

/// Bits reserved for the slot index; the rest carry the generation.
const INDEX_BITS = 20;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
pub const MAX_CAPACITY: usize = INDEX_MASK;

pub const NO_HANDLE: i32 = -1;

pub const Error = error{
    PoolExhausted,
    StaleHandle,
    InvalidHandle,
};

pub fn Pool(comptime capacity: usize) type {
    comptime {
        std.debug.assert(capacity > 0);
        std.debug.assert(capacity <= MAX_CAPACITY);
    }

    return struct {
        const Self = @This();

        pub const Slot = struct {
            /// Master side of the PTY, or -1 when unused.
            fd: i32 = -1,
            /// Child process id, or -1 when unused.
            pid: i32 = -1,
            cols: u16 = 80,
            rows: u16 = 24,
            state: SlotState = .closed,
            /// Exit status once reaped; -2 means "not yet reaped".
            exit_code: i32 = -2,
            /// Monotonic counter; bumped on every release.
            generation: u32 = 0,
        };

        slots: [capacity]Slot = [_]Slot{.{}} ** capacity,
        free: [capacity]u32 = undefined,
        free_len: usize = 0,
        live: usize = 0,

        /// Prepare the pool. Must be called before any other operation.
        pub fn init(self: *Self) void {
            for (0..capacity) |i| {
                self.slots[i] = .{};
                self.free[i] = @intCast(i);
            }
            self.free_len = capacity;
            self.live = 0;
        }

        pub fn liveCount(self: *const Self) usize {
            return self.live;
        }

        pub fn capacityTotal(self: *const Self) usize {
            return capacity;
        }

        /// Number of slots still available.
        pub fn available(self: *const Self) usize {
            return self.free_len;
        }

        /// Acquire a slot, returning a generation-tagged handle.
        pub fn acquire(self: *Self) Error!i32 {
            if (self.free_len == 0) return error.PoolExhausted;
            self.free_len -= 1;
            const idx = self.free[self.free_len];
            self.live += 1;
            return @intCast((self.slots[idx].generation << INDEX_BITS) | idx);
        }

        /// Return a slot to the free list. The stored generation is bumped so
        /// outstanding handles for this slot stop resolving.
        pub fn release(self: *Self, handle: i32) Error!void {
            const idx = try self.index(handle);
            self.slots[idx].generation +%= 1;
            self.slots[idx] = .{ .generation = self.slots[idx].generation };
            self.free[self.free_len] = idx;
            self.free_len += 1;
            self.live -= 1;
        }

        /// Resolve a handle to its slot, or fail if it is stale/invalid.
        pub fn get(self: *Self, handle: i32) Error!*Slot {
            const idx = try self.index(handle);
            return &self.slots[idx];
        }

        pub fn getConst(self: *const Self, handle: i32) Error!*const Slot {
            const idx = try self.index(handle);
            return &self.slots[idx];
        }

        /// Queue up to `out.len` entries describing live slots.
        pub fn snapshot(self: *const Self, out: []SlotView) usize {
            var n: usize = 0;
            for (self.slots, 0..) |slot, i| {
                if (n >= out.len) break;
                if (slot.state == .closed) continue;
                out[n] = .{
                    .index = @intCast(i),
                    .fd = slot.fd,
                    .pid = slot.pid,
                    .cols = slot.cols,
                    .rows = slot.rows,
                    .state = slot.state,
                    .exit_code = slot.exit_code,
                };
                n += 1;
            }
            return n;
        }

        fn index(self: *const Self, handle: i32) Error!usize {
            if (handle < 0) return error.InvalidHandle;
            const h: u32 = @intCast(handle);
            const idx = h & INDEX_MASK;
            const gen = h >> INDEX_BITS;
            if (idx >= capacity) return error.InvalidHandle;
            if (self.slots[idx].state == .closed and gen == 0) return error.InvalidHandle;
            if (self.slots[idx].generation != gen) return error.StaleHandle;
            return idx;
        }
    };
}

/// Borrowed view of a slot for reporting across the FFI boundary.
pub const SlotView = struct {
    index: u32,
    fd: i32,
    pid: i32,
    cols: u16,
    rows: u16,
    state: SlotState,
    exit_code: i32,
};

test "acquire and release cycle" {
    var p = Pool(4){};
    p.init();
    try testing.expectEqual(@as(usize, 4), p.available());
    try testing.expectEqual(@as(usize, 0), p.liveCount());

    const h = try p.acquire();
    try testing.expect(h >= 0);
    try testing.expectEqual(@as(usize, 3), p.available());
    try testing.expectEqual(@as(usize, 1), p.liveCount());

    try p.release(h);
    try testing.expectEqual(@as(usize, 4), p.available());
    try testing.expectEqual(@as(usize, 0), p.liveCount());
}

test "exhaustion is reported" {
    var p = Pool(2){};
    p.init();
    _ = try p.acquire();
    _ = try p.acquire();
    try testing.expectError(error.PoolExhausted, p.acquire());
}

test "released handle becomes stale" {
    var p = Pool(4){};
    p.init();
    const h = try p.acquire();
    try p.release(h);
    try testing.expectError(error.StaleHandle, p.get(h));
}

test "negative handle is invalid" {
    var p = Pool(4){};
    p.init();
    try testing.expectError(error.InvalidHandle, p.get(NO_HANDLE));
    try testing.expectError(error.InvalidHandle, p.get(-12345));
}

test "out of range index is invalid" {
    var p = Pool(4){};
    p.init();
    try testing.expectError(error.InvalidHandle, p.get(99));
}

test "slot fields survive acquire" {
    var p = Pool(4){};
    p.init();
    const h = try p.acquire();

    {
        const s = try p.get(h);
        s.fd = 7;
        s.pid = 4242;
        s.cols = 120;
        s.rows = 40;
        s.state = .running;
    }

    const s = try p.getConst(h);
    try testing.expectEqual(@as(i32, 7), s.fd);
    try testing.expectEqual(@as(i32, 4242), s.pid);
    try testing.expectEqual(@as(u16, 120), s.cols);
    try testing.expectEqual(@as(u16, 40), s.rows);
    try testing.expectEqual(SlotState.running, s.state);
}

test "handle reuse after release is usable again" {
    var p = Pool(1){};
    p.init();

    const first = try p.acquire();
    try p.release(first);

    const second = try p.acquire();
    // Same index, different generation.
    try testing.expectEqual(first & INDEX_MASK, second & INDEX_MASK);
    try testing.expect(second != first);
    try testing.expectError(error.StaleHandle, p.get(first));

    {
        const s = try p.get(second);
        s.state = .running;
        s.exit_code = 0;
    }
    try testing.expectEqual(SlotState.running, (try p.getConst(second)).state);
}

test "snapshot reports only live slots" {
    var p = Pool(4){};
    p.init();

    const a = try p.acquire();
    const b = try p.acquire();
    try p.release(a);

    {
        const s = try p.get(b);
        s.state = .running;
        s.pid = 99;
        s.fd = 3;
    }

    var views: [4]SlotView = undefined;
    const n = p.snapshot(&views);
    try testing.expectEqual(@as(usize, 1), n);
    try testing.expectEqual(@as(i32, 99), views[0].pid);
    try testing.expectEqual(SlotState.running, views[0].state);
}

test "snapshot respects output capacity" {
    var p = Pool(8){};
    p.init();
    for (0..5) |_| {
        const h = try p.acquire();
        (try p.get(h)).state = .running;
    }
    var views: [2]SlotView = undefined;
    try testing.expectEqual(@as(usize, 2), p.snapshot(&views));
}

test "generation wrapping does not alias live handles" {
    var p = Pool(1){};
    p.init();
    // Force the generation to the maximum so the next release wraps it.
    (try p.get(try p.acquire())).generation = std.math.maxInt(u32);

    const h = try p.acquire();
    try p.release(h);
    // Generation wrapped to 0 and state reset; the new handle is valid and the
    // old one resolves to the same fresh slot rather than a stale one.
    const h2 = try p.acquire();
    try testing.expectEqual(h & INDEX_MASK, h2 & INDEX_MASK);
    try testing.expectEqual(@as(u32, 0), (try p.getConst(h2)).generation);
}
