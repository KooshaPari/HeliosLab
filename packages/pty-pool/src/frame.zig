//! Length-prefixed framing for the PTY -> renderer byte channel.
//!
//! Frames are `[kind: u8][length: u32 little-endian][payload...]`. The renderer
//! demultiplexes output, exit notifications, and errors on a single stream.

const std = @import("std");
const testing = std.testing;

pub const Kind = enum(u8) {
    /// Raw terminal bytes destined for xterm.js.
    output = 1,
    /// Child process exited; payload is unused, see `exit_code` frames.
    exit = 2,
    /// Non-fatal error; payload is a UTF-8 message.
    err = 3,
    /// Acknowledges a resize request; payload is unused.
    resize_ack = 4,

    pub fn fromInt(v: u8) ?Kind {
        return switch (v) {
            1 => .output,
            2 => .exit,
            3 => .err,
            4 => .resize_ack,
            else => null,
        };
    }
};

pub const HEADER_SIZE: usize = 5;
pub const MAX_PAYLOAD: usize = 256 * 1024;

pub const Header = struct {
    kind: Kind,
    len: u32,
};

pub const FrameError = error{
    UnknownKind,
    PayloadTooLarge,
};

/// Serialise a header into `out`.
pub fn encodeHeader(out: *[HEADER_SIZE]u8, kind: Kind, len: u32) void {
    out[0] = @intFromEnum(kind);
    std.mem.writeInt(u32, out[1..HEADER_SIZE], len, .little);
}

/// Parse a header, rejecting unknown kinds and oversized payloads.
pub fn decodeHeader(in: *const [HEADER_SIZE]u8) FrameError!Header {
    const kind = Kind.fromInt(in[0]) orelse return error.UnknownKind;
    const len = std.mem.readInt(u32, in[1..HEADER_SIZE], .little);
    if (len > MAX_PAYLOAD) return error.PayloadTooLarge;
    return .{ .kind = kind, .len = len };
}

/// Total bytes on the wire for a payload of `payload_len`.
pub fn frameSize(payload_len: usize) usize {
    return HEADER_SIZE + payload_len;
}

test "round trips every kind" {
    var buf: [HEADER_SIZE]u8 = undefined;
    for ([_]Kind{ .output, .exit, .err, .resize_ack }) |kind| {
        encodeHeader(&buf, kind, 1234);
        const h = try decodeHeader(&buf);
        try testing.expectEqual(kind, h.kind);
        try testing.expectEqual(@as(u32, 1234), h.len);
    }
}

test "round trips boundary lengths" {
    var buf: [HEADER_SIZE]u8 = undefined;
    for ([_]u32{ 0, 1, 255, 256, 65535, 65536, @intCast(MAX_PAYLOAD) }) |len| {
        encodeHeader(&buf, .output, len);
        const h = try decodeHeader(&buf);
        try testing.expectEqual(len, h.len);
    }
}

test "header is little endian" {
    var buf: [HEADER_SIZE]u8 = undefined;
    encodeHeader(&buf, .output, 0x01020304);
    try testing.expectEqual(@as(u8, 1), buf[0]);
    try testing.expectEqual(@as(u8, 0x04), buf[1]);
    try testing.expectEqual(@as(u8, 0x03), buf[2]);
    try testing.expectEqual(@as(u8, 0x02), buf[3]);
    try testing.expectEqual(@as(u8, 0x01), buf[4]);
}

test "rejects unknown kind" {
    const buf = [HEADER_SIZE]u8{ 99, 0, 0, 0, 0 };
    try testing.expectError(error.UnknownKind, decodeHeader(&buf));
}

test "rejects kind zero" {
    const buf = [HEADER_SIZE]u8{ 0, 0, 0, 0, 0 };
    try testing.expectError(error.UnknownKind, decodeHeader(&buf));
}

test "rejects oversized payload" {
    var buf: [HEADER_SIZE]u8 = undefined;
    encodeHeader(&buf, .output, @intCast(MAX_PAYLOAD + 1));
    try testing.expectError(error.PayloadTooLarge, decodeHeader(&buf));
}

test "accepts maximum payload" {
    var buf: [HEADER_SIZE]u8 = undefined;
    encodeHeader(&buf, .output, @intCast(MAX_PAYLOAD));
    const h = try decodeHeader(&buf);
    try testing.expectEqual(@as(u32, @intCast(MAX_PAYLOAD)), h.len);
}

test "frameSize accounts for header" {
    try testing.expectEqual(@as(usize, 5), frameSize(0));
    try testing.expectEqual(@as(usize, 261), frameSize(256));
}
