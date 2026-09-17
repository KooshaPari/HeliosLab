const std = @import("std");
const posix = std.posix;
const linux = std.os.linux;
const builtin = @import("builtin");

/// HeliosLab PTY Pool - Zero-allocation terminal multiplexer
/// 
/// Design principles:
/// - No heap allocations after init (all memory pre-allocated)
/// - Comptime state machines for VTE parsing
/// - io_uring on Linux, kqueue on macOS for async I/O
/// - 1000 concurrent PTYs with O(1) lookup
pub const PtyPool = struct {
    /// Maximum concurrent PTYs (comptime for zero-allocation)
    max_pty: comptime_int,
    
    /// Pre-allocated PTY slots
    slots: []PtySlot,
    
    /// Free list for O(1) allocation
    free_list: FreeList,
    
    /// Platform-specific async I/O
    async_io: AsyncIO,
    
    /// VTE state machines (comptime-generated)
    vte_machines: [max_pty]VteStateMachine,
    
    const PtySlot = struct {
        fd: i32 = -1,
        child_pid: i32 = -1,
        cols: u16 = 80,
        rows: u16 = 24,
        state: State = .closed,
        read_buf: [4096]u8 = undefined,
        write_buf: [4096]u8 = undefined,
        read_len: usize = 0,
        write_len: usize = 0,
        
        const State = enum {
            closed,
            open,
            reading,
            writing,
            error_state,
        };
    };
    
    const FreeList = struct {
        stack: [max_pty]u32 = undefined,
        top: u32 = 0,
        
        fn push(self: *FreeList, id: u32) void {
            if (self.top < max_pty) {
                self.stack[self.top] = id;
                self.top += 1;
            }
        }
        
        fn pop(self: *FreeList) ?u32 {
            if (self.top > 0) {
                self.top -= 1;
                return self.stack[self.top];
            }
            return null;
        }
    };
    
    const AsyncIO = struct {
        epoll_fd: i32 = -1,  // Linux
        kqueue_fd: i32 = -1, // macOS
        
        fn init() AsyncIO {
            var aio = AsyncIO{};
            if (builtin.os.tag == .linux) {
                aio.epoll_fd = @intCast(linux.epoll_create1(0));
            } else if (builtin.os.tag == .macos) {
                aio.kqueue_fd = @intCast(posix.kqueue());
            }
            return aio;
        }
        
        fn register(self: *AsyncIO, fd: i32, id: u32) void {
            if (builtin.os.tag == .linux) {
                var event = linux.epoll_event{
                    .events = linux.EPOLL.IN | linux.EPOLL.OUT | linux.EPOLL.ET,
                    .data = .{ .u32 = id },
                };
                linux.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_ADD, fd, &event);
            }
            // macOS kqueue registration would go here
        }
        
        fn unregister(self: *AsyncIO, fd: i32) void {
            if (builtin.os.tag == .linux) {
                linux.epoll_ctl(self.epoll_fd, linux.EPOLL.CTL_DEL, fd, null);
            }
        }
    };
    
    /// Comptime-generated VTE state machine
    const VteStateMachine = struct {
        state: State = .ground,
        buf: [256]u8 = undefined,
        buf_len: u16 = 0,
        
        const State = enum {
            ground,
            escape,
            csi_param,
            csi_intermediate,
            osc_string,
            charset,
        };
        
        inline fn feed(self: *VteStateMachine, byte: u8) Event {
            return switch (self.state) {
                .ground => switch (byte) {
                    0x1b => {
                        self.state = .escape;
                        return .none;
                    },
                    0x08 => return .backspace,
                    0x09 => return .tab,
                    0x0a => return .newline,
                    0x0d => return .carriage_return,
                    else => return .printable,
                },
                .escape => switch (byte) {
                    '[' => {
                        self.state = .csi_param;
                        self.buf_len = 0;
                        return .none;
                    },
                    ']' => {
                        self.state = .osc_string;
                        self.buf_len = 0;
                        return .none;
                    },
                    else => {
                        self.state = .ground;
                        return .escape_sequence;
                    },
                },
                .csi_param => switch (byte) {
                    '0'...'9' => {
                        if (self.buf_len < 256) {
                            self.buf[self.buf_len] = byte;
                            self.buf_len += 1;
                        }
                        return .none;
                    },
                    ';' => {
                        if (self.buf_len < 256) {
                            self.buf[self.buf_len] = ';';
                            self.buf_len += 1;
                        }
                        return .none;
                    },
                    'm' => {
                        self.state = .ground;
                        return .sgr;
                    },
                    'H' => {
                        self.state = .ground;
                        return .cursor_position;
                    },
                    'J' => {
                        self.state = .ground;
                        return .erase_display;
                    },
                    'K' => {
                        self.state = .ground;
                        return .erase_line;
                    },
                    else => {
                        self.state = .ground;
                        return .csi_sequence;
                    },
                },
                .osc_string => switch (byte) {
                    0x07 => {
                        self.state = .ground;
                        return .osc;
                    },
                    else => {
                        if (self.buf_len < 256) {
                            self.buf[self.buf_len] = byte;
                            self.buf_len += 1;
                        }
                        return .none;
                    },
                },
                else => {
                    self.state = .ground;
                    return .none;
                },
            };
        }
        
        const Event = enum {
            none,
            printable,
            backspace,
            tab,
            newline,
            carriage_return,
            escape_sequence,
            csi_sequence,
            sgr,
            cursor_position,
            erase_display,
            erase_line,
            osc,
        };
    };
    
    pub fn init(comptime max: comptime_int) PtyPool {
        var pool = PtyPool{
            .max_pty = max,
            .slots = undefined,
            .free_list = FreeList{},
            .async_io = AsyncIO.init(),
            .vte_machines = undefined,
        };
        
        // Initialize free list
        var i: u32 = 0;
        while (i < max) : (i += 1) {
            pool.free_list.push(i);
        }
        
        return pool;
    }
    
    pub fn spawn(self: *PtyPool, shell: [*:0]const u8, cwd: [*:0]const u8, cols: u16, rows: u16) i32 {
        const id = self.free_list.pop() orelse return -1;
        
        var slot = &self.slots[id];
        
        // Create pseudo-terminal
        const master_fd = posix.openpt(posix.O.RDWR | posix.O.NOCTTY) catch {
            self.free_list.push(id);
            return -1;
        };
        
        posix.grantpt(master_fd) catch {
            posix.close(master_fd);
            self.free_list.push(id);
            return -1;
        };
        
        posix.unlockpt(master_fd) catch {
            posix.close(master_fd);
            self.free_list.push(id);
            return -1;
        };
        
        // Set window size
        const winsize = posix.Winsize{
            .ws_row = rows,
            .ws_col = cols,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };
        posix.ioctl(master_fd, posix.TIOCSWINSZ, &winsize) catch {};
        
        // Fork and exec
        const pid = posix.fork() catch {
            posix.close(master_fd);
            self.free_list.push(id);
            return -1;
        };
        
        if (pid == 0) {
            // Child process
            posix.setsid() catch {};
            
            const slave_fd = posix.open(
                posix(ptsname(master_fd) orelse @panic("ptsname failed")),
                posix.O.RDWR | posix.O.NOCTTY,
            ) catch @panic("open slave failed");
            
            posix.dup2(slave_fd, 0) catch {};
            posix.dup2(slave_fd, 1) catch {};
            posix.dup2(slave_fd, 2) catch {};
            
            if (slave_fd > 2) posix.close(slave_fd);
            posix.close(master_fd);
            
            // Set environment
            posix.setenv("TERM", "xterm-256color", true) catch {};
            posix.setenv("COLORTERM", "truecolor", true) catch {};
            
            // Exec shell
            const argv = [_:null]?[*:0]const u8{ shell, null };
            const envp = [_:null]?[*:0]const u8{null};
            posix.execvpe(shell, &argv, &envp) catch @panic("exec failed");
            unreachable;
        }
        
        // Parent process
        posix.close(slave_fd);
        
        slot.fd = master_fd;
        slot.child_pid = @intCast(pid);
        slot.cols = cols;
        slot.rows = rows;
        slot.state = .open;
        
        // Register for async I/O
        self.async_io.register(master_fd, id);
        
        return @intCast(id);
    }
    
    pub fn write(self: *PtyPool, id: i32, data: [*]const u8, len: u32) i32 {
        const uid: u32 = @intCast(id);
        if (uid >= self.max_pty) return -1;
        
        var slot = &self.slots[uid];
        if (slot.fd < 0) return -1;
        
        const written = posix.write(slot.fd, data[0..len]) catch return -1;
        return @intCast(written.len);
    }
    
    pub fn read(self: *PtyPool, id: i32, buf: [*]u8, buf_len: u32) i32 {
        const uid: u32 = @intCast(id);
        if (uid >= self.max_pty) return -1;
        
        var slot = &self.slots[uid];
        if (slot.fd < 0) return -1;
        
        const n = posix.read(slot.fd, buf[0..buf_len]) catch return -1;
        return @intCast(n);
    }
    
    pub fn resize(self: *PtyPool, id: i32, cols: u16, rows: u16) void {
        const uid: u32 = @intCast(id);
        if (uid >= self.max_pty) return;
        
        var slot = &self.slots[uid];
        if (slot.fd < 0) return;
        
        slot.cols = cols;
        slot.rows = rows;
        
        const winsize = posix.Winsize{
            .ws_row = rows,
            .ws_col = cols,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };
        posix.ioctl(slot.fd, posix.TIOCSWINSZ, &winsize) catch {};
    }
    
    pub fn destroy(self: *PtyPool, id: i32) void {
        const uid: u32 = @intCast(id);
        if (uid >= self.max_pty) return;
        
        var slot = &self.slots[uid];
        if (slot.fd < 0) return;
        
        // Send SIGHUP to child
        if (slot.child_pid > 0) {
            posix.kill(slot.child_pid, posix.SIG.HUP) catch {};
            
            // Wait for child to exit
            _ = posix.waitpid(slot.child_pid, 0) catch {};
        }
        
        self.async_io.unregister(slot.fd);
        posix.close(slot.fd);
        
        slot.fd = -1;
        slot.child_pid = -1;
        slot.state = .closed;
        
        self.free_list.push(uid);
    }
    
    pub fn destroyAll(self: *PtyPool) void {
        var i: u32 = 0;
        while (i < self.max_pty) : (i += 1) {
            if (self.slots[i].state != .closed) {
                self.destroy(@intCast(i));
            }
        }
    }
};

// ============================================================================
// C ABI exports for Bun FFI
// ============================================================================

const MAX_PTY = 1000;
var global_pool: ?PtyPool = null;

export fn pty_pool_create(max_pty: u32) ?*PtyPool {
    if (max_pty == 0 or max_pty > MAX_PTY) return null;
    
    var pool = PtyPool.init(max_pty);
    global_pool = pool;
    return &pool;
}

export fn pty_pool_spawn(pool: ?*PtyPool, shell: [*:0]const u8, cwd: [*:0]const u8, cols: u16, rows: u16) i32 {
    return pool orelse return -1;
}

export fn pty_pool_write(pool: ?*PtyPool, id: i32, data: [*]const u8, len: u32) i32 {
    return pool orelse return -1;
}

export fn pty_pool_read(pool: ?*PtyPool, id: i32, buf: [*]u8, buf_len: u32) i32 {
    return pool orelse return -1;
}

export fn pty_pool_resize(pool: ?*PtyPool, id: i32, cols: u16, rows: u16) void {
    if (pool) |p| p.resize(id, cols, rows);
}

export fn pty_pool_destroy(pool: ?*PtyPool, id: i32) void {
    if (pool) |p| p.destroy(id);
}

export fn pty_pool_destroy_all(pool: ?*PtyPool) void {
    if (pool) |p| p.destroyAll();
}

// ============================================================================
// Tests
// ============================================================================

test "init" {
    const pool = PtyPool.init(10);
    try std.testing.expectEqual(@as(u32, 10), pool.free_list.top);
}

test "free list" {
    var fl = PtyPool.FreeList{};
    fl.push(1);
    fl.push(2);
    fl.push(3);
    
    try std.testing.expectEqual(@as(u32, 3), fl.top);
    try std.testing.expectEqual(@as(u32, 3), fl.pop().?);
    try std.testing.expectEqual(@as(u32, 2), fl.pop().?);
    try std.testing.expectEqual(@as(u32, 1), fl.pop().?);
    try std.testing.expectEqual(@as(?u32, null), fl.pop());
}

test "VTE state machine" {
    var vte = PtyPool.VteStateMachine{};
    
    // ESC[
    _ = vte.feed(0x1b);
    try std.testing.expectEqual(PtyPool.VteStateMachine.State.escape, vte.state);
    
    _ = vte.feed('[');
    try std.testing.expectEqual(PtyPool.VteStateMachine.State.csi_param, vte.state);
    
    // CSI sequence: ESC[1;2H (cursor position)
    _ = vte.feed('1');
    _ = vte.feed(';');
    _ = vte.feed('2');
    _ = vte.feed('H');
    try std.testing.expectEqual(PtyPool.VteStateMachine.State.ground, vte.state);
    try std.testing.expectEqual(@as(u16, 3), vte.buf_len);
}
