const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Portable core tests. These run on any host, including the Windows
    // development machine, because they touch no operating-system APIs.
    //
    // Zig 0.16 replaced TestOptions.root_source_file with a root_module, so the
    // module has to be built explicitly the same way the library's is.
    const core_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/core_test.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    const run_core_tests = b.addRunArtifact(core_tests);
    const test_step = b.step("test", "Run portable core unit tests");
    test_step.dependOn(&run_core_tests.step);

    // The shared library is POSIX-only. Building it for Windows is a mistake,
    // so fail loudly rather than producing something that cannot work.
    const lib = b.addLibrary(.{
        .name = "helios-pty",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
        .linkage = .dynamic,
    });
    lib.linker_allow_shlib_undefined = false;

    const install_lib = b.addInstallArtifact(lib, .{});
    const lib_step = b.step("lib", "Build the PTY pool shared library (POSIX only)");
    lib_step.dependOn(&install_lib.step);

    if (target.result.os.tag == .windows) {
        lib_step.dependOn(&b.addFail(
            "helios-pty targets macOS and Linux; Windows has no POSIX PTY. " ++
                "Use -Dtarget=aarch64-macos to cross-compile.",
        ).step);
    }

    // `zig build` with no arguments builds the library when the target is
    // supported, and the portable tests otherwise.
    const default_step = b.getInstallStep();
    if (target.result.os.tag == .windows) {
        default_step.dependOn(&run_core_tests.step);
    } else {
        default_step.dependOn(&install_lib.step);
    }

    // Convenience: `zig build test-core` is an alias people reach for.
    const core_alias = b.step("test-core", "Alias for `test`");
    core_alias.dependOn(&run_core_tests.step);
}
