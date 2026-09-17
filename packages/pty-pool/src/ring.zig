//! Fixed-capacity byte ring buffer used to decouple PTY reads from the
//! renderer's consumption rate.
//!
//! No allocation: the backing store is comptime-sized, so a pool of N PTYs
//! costs a known, fixed amount of memory up front.

const std = @import("std");

pub fn Ring(comptime capacity: usize) type {
    comptime {
        std.debug.assert(capacity > 0);
        std.debug.assert(std.math.isPowerOfTwo(capacity));
    }

    return struct {
        const Self = @This();

        buf: [capacity]u8 = undefined,
        /// Index of the next byte to be read.
        head: usize = 0,
        /// Number of valid bytes currently buffered.
        len: usize = 0,

        /// Bytes available to read.
        pub fn readable(self: *const Self) usize {
            return self.len;
        }

        /// Space available for writing.
        pub fn writable(self: *const Self) usize {
            return capacity - self.len;
        }

        pub fn isEmpty(self: *const Self) bool {
            return self.len == 0;
        }

        pub fn isFull(self: *const Self) bool {
            return self.len == capacity;
        }

        /// Discard all buffered bytes.
        pub fn clear(self: *Self) void {
            self.head = 0;
            self.len = 0;
        }

        /// Append as much of `data` as fits. Returns the number of bytes
        /// accepted, which is less than `data.len` when the ring is full
        /// (backpressure).
        pub fn write(self: *Self, data: []const u8) usize {
            const n = @min(data.len, self.writable());
            if (n == 0) return 0;

            const tail = (self.head + self.len) & (capacity - 1);
            const first = @min(n, capacity - tail);
            @memcpy(self.buf[tail..][0..first], data[0..first]);
            if (n > first) {
                @memcpy(self.buf[0..][0 .. n - first], data[first..n]);
            }
            self.len += n;
            return n;
        }

        /// Copy out up to `out.len` buffered bytes. Returns bytes copied.
        pub fn read(self: *Self, out: []u8) usize {
            const n = @min(out.len, self.len);
            if (n == 0) return 0;

            const first = @min(n, capacity - self.head);
            @memcpy(out[0..first], self.buf[self.head..][0..first]);
            if (n > first) {
                @memcpy(out[first..n], self.buf[0 .. n - first]);
            }
            self.head = (self.head + n) & (capacity - 1);
            self.len -= n;
            return n;
        }

        /// Peek at the next `out.len` bytes without consuming them.
        pub fn peek(self: *const Self, out: []u8) usize {
            const n = @min(out.len, self.len);
            if (n == 0) return 0;

            const first = @min(n, capacity - self.head);
            @memcpy(out[0..first], self.buf[self.head..][0..first]);
            if (n > first) {
                @memcpy(out[first..n], self.buf[0 .. n - first]);
            }
            return n;
        }

        /// Drop the oldest `n` bytes.
        pub fn skip(self: *Self, n: usize) usize {
            const dropped = @min(n, self.len);
            self.head = (self.head + dropped) & (capacity - 1);
            self.len -= dropped;
            return dropped;
        }
    };
}

const testing = std.testing;

test "starts empty" {
    var r = Ring(16){};
    try testing.expectEqual(@as(usize, 0), r.readable());
    try testing.expectEqual(@as(usize, 16), r.writable());
    try testing.expect(r.isEmpty());
}

test "write then read round trips" {
    var r = Ring(16){};
    var out: [16]u8 = undefined;

    try testing.expectEqual(@as(usize, 3), r.write("abc"));
    try testing.expectEqual(@as(usize, 3), r.readable());

    const n = r.read(&out);
    try testing.expectEqual(@as(usize, 3), n);
    try testing.expectEqualStrings("abc", out[0..n]);
    try testing.expect(r.isEmpty());
}

test "enforces capacity and reports backpressure" {
    var r = Ring(8){};
    try testing.expectEqual(@as(usize, 8), r.write("01234567"));
    try testing.expect(r.isFull());
    // Nothing more fits; caller must drain.
    try testing.expectEqual(@as(usize, 0), r.write("89"));
    try testing.expectEqual(@as(usize, 0), r.writable());
}

test "partial write when only some bytes fit" {
    var r = Ring(8){};
    _ = r.write("012345");
    try testing.expectEqual(@as(usize, 2), r.write("6789"));
    try testing.expect(r.isFull());
}

test "wraps around the end of the buffer" {
    var r = Ring(8){};
    var out: [8]u8 = undefined;

    _ = r.write("abcde");
    _ = r.read(&out); // head now at 5
    _ = r.write("fghij"); // wraps: 3 at index 5,6,7 then 2 at 0,1

    const n = r.read(&out);
    try testing.expectEqual(@as(usize, 5), n);
    try testing.expectEqualStrings("fghij", out[0..n]);
    try testing.expect(r.isEmpty());
}

test "peek does not consume" {
    var r = Ring(8){};
    var out: [4]u8 = undefined;
    _ = r.write("wxyz");

    try testing.expectEqual(@as(usize, 4), r.peek(&out));
    try testing.expectEqualStrings("wxyz", out[0..4]);
    try testing.expectEqual(@as(usize, 4), r.readable());

    _ = r.read(&out);
    try testing.expect(r.isEmpty());
}

test "skip drops oldest bytes" {
    var r = Ring(8){};
    var out: [8]u8 = undefined;
    _ = r.write("abcdefg");

    try testing.expectEqual(@as(usize, 3), r.skip(3));
    const n = r.read(&out);
    try testing.expectEqualStrings("defg", out[0..n]);
}

test "skip clamps to available" {
    var r = Ring(8){};
    _ = r.write("ab");
    try testing.expectEqual(@as(usize, 2), r.skip(99));
    try testing.expect(r.isEmpty());
}

test "clear resets" {
    var r = Ring(8){};
    _ = r.write("abcd");
    r.clear();
    try testing.expect(r.isEmpty());
    try testing.expectEqual(@as(usize, 8), r.writable());
}

test "read into zero length buffer is a no-op" {
    var r = Ring(8){};
    _ = r.write("ab");
    try testing.expectEqual(@as(usize, 0), r.read(&[_]u8{}));
    try testing.expectEqual(@as(usize, 2), r.readable());
}

test "preserves byte order across many wraps" {
    var r = Ring(64){};
    var out: [64]u8 = undefined;

    var next_write: u32 = 0;
    var next_expect: u32 = 0;

    while (next_expect < 5000) {
        if (next_write < 5000 and r.writable() > 0) {
            const chunk = [_]u8{@truncate(next_write)};
            if (r.write(&chunk) == 1) next_write += 1;
        }
        const n = r.read(&out);
        for (out[0..n]) |b| {
            try testing.expectEqual(@as(u8, @truncate(next_expect)), b);
            next_expect += 1;
        }
        try testing.expect(r.readable() <= 64);
    }
}
