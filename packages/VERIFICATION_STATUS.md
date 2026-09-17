# HeliosLab Native Integration — Verification Status

**Date:** 2026-09-17
**Scope:** the Zig / Rust / Go / Mojo packages added to the HeliosLab monorepo.

This file exists because an earlier revision of this work marked every package
"verified" when nothing had been compiled. It records what has actually been
executed, and what has not.

---

## What was actually run

| Component | Command | Result |
|-----------|---------|--------|
| Go orchestrator | `go vet ./...` | clean (exit 0) |
| Go orchestrator | `go test -count=1 ./...` | **14/14 pass** |
| Go device manager | `go vet ./...` | clean (exit 0) |
| Go device manager + SSH transport | `go test -count=1 ./...` | **51/51 pass** |
| TS FFI bridge | `bun test packages/runtime-core/tests/unit/ffi_bridge.test.ts` | **3/3 pass** |

Two real bugs were found and fixed by these tests:

1. `ParseUptime` stopped at the first comma, so `up 3 days, 4:05` reported only
   3 days of uptime. Three regression tests now cover it.
2. The compiler rejected my correction to `ssh.ParseKnownHosts`, which returns
   6 values, not 7. Reverted.

The device-manager tests also cover the security-critical path: host key
verification. The first draft used `ssh.InsecureIgnoreHostKey`, which accepts
any key an attacker presents. It now fails closed, reports the presented
fingerprint, and has OpenSSH-style pattern matching with `!` negation.


The TS test also confirms the integration property that matters: importing the
bridge never throws, and a missing native library produces an actionable
`NativeUnavailableError` instead of a crash.

---

## What could NOT be verified

No C compiler exists on this machine, and Zig / Rust / Mojo are not installed
locally or on the macOS build host. Concretely:

| Component | Blocker | Status |
|-----------|---------|--------|
| Zig PTY pool | `zig` not installed (97 MB download, ~0.3 MB/min here) | **never compiled** |
| Rust persistence | no `cargo`, and no C compiler for `rusqlite`'s bundled SQLite | **never compiled** |
| Mojo inference router | `mojo` not installed; no MAX toolchain | **never compiled** |
| Go c-shared library | `CGO_ENABLED=0` (no gcc/clang on Windows) | **never linked** |

The Go *logic* is verified. The Go `c-shared` **link step** is not: it needs cgo,
and therefore a C toolchain.

---

## How to close the gaps

The PTY pool is written so its portable core is testable anywhere:

```bash
cd packages/pty-pool
zig build test            # ring buffer, frame codec, pool bookkeeping
zig build lib -Dtarget=aarch64-macos   # cross-compile for the real target
```

For Rust, a C compiler is required before `cargo check` will get past
`rusqlite`'s build script:

```bash
cd packages/persistence && cargo check --release
```

For the Go shared libraries, install a C toolchain and set `CGO_ENABLED=1`, then:

```bash
bun run build:native
```

---

## Design changes made in this revision

1. **Zig no longer re-implements terminal emulation.** The first draft contained
   a VTE state machine, which duplicates xterm.js. That supersedes an existing
   component instead of integrating with it, so it was removed. Zig now owns the
   PTY layer only: spawn, pump, buffer, resize, reap, plus a length-prefixed
   frame codec for the byte channel and a per-session ring buffer for
   backpressure.

2. **`fork` + `exec` replaced with `posix_spawn`.** The library is called from a
   threaded JS runtime; `fork` in a multithreaded process can deadlock.

3. **Generation-tagged PTY handles.** A handle for a recycled slot now fails
   cleanly rather than addressing another session's terminal.

4. **Go split into a dependency-free core plus a thin cgo shim.** This is what
   made `go test` possible without any toolchain install, and it keeps the
   tested surface and the FFI surface separate.

5. **Rust no longer calls `rusqlite::MappedRows::new`,** which does not exist.
   Interior NUL bytes are stripped instead of panicking `CString::new`.

---

## Honest summary

Verified by execution: Go orchestrator logic, Go device-manager logic including
the SSH host-key path, the TS FFI bridge contract.
Not verified: every line of Zig, Rust, and Mojo, and the cgo link step.

---

## Open questions (blocking verification, not code)

These are decisions, not tasks. No further agent work changes them.

### 1. Where should toolchains be installed?

Zig is downloading to `agents/sandbox/toolchains/` (~1 MB/min on this link, so
~45 min). Rust is worse: `cargo check` needs *both* rustup *and* a C compiler,
because `rusqlite`'s bundled feature compiles SQLite from source. At this
bandwidth a Rust toolchain is a multi-hour download, and a MinGW/MSVC compiler
would be needed on top.

`kooshas-laptop` (macOS 27, arm64) is reachable over Tailscale and is the real
shipping target, since Electrobun is macOS-first. Installing Zig, Rust, and Bun
there would verify Zig, Rust, *and* the cgo link step in one place, on the
correct architecture. That is the cheaper and more meaningful option, but it
means installing toolchains on a personal machine.

### 2. Finish Mojo, or replace it with a TypeScript router?

`packages/inference/mojo/inference_router.mojo` is a sketch with known defects
listed in its header. There is no MAX toolchain to compile it with.

The user has said they want exotic languages, so this is deliberately left in
place rather than deleted. The alternative is a TypeScript router, which would
be testable the same day and could still delegate to Mojo later once MAX is
installed. This needs a product call, not a technical one.

### Not a question

The `.github/workflows/native.yml` workflow closes the verification gap for
everything above without any local install. It has been written and its YAML
validated, but it has never been observed running on a runner, so it is not
counted as evidence yet. Pushing this branch is the cheapest way to find out
whether Zig, Rust, and the cgo shims actually compile.

