//! Test root for the portable core.
//!
//! `main.zig` and `pty_unix.zig` are deliberately excluded: they depend on
//! POSIX headers and cannot be built on Windows. They are verified separately
//! by cross-compiling for the real target (`zig build -Dtarget=aarch64-macos`).

test {
    _ = @import("ring.zig");
    _ = @import("frame.zig");
    _ = @import("pool.zig");
}
