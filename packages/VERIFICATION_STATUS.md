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
| Go device manager + SSH transport | `go test -count=1 ./...` | **53/53 pass** |
| TS FFI bridge | `bun test .../ffi_bridge.test.ts` | **3/3 pass** |
| TS FFI bridge | `tsc --noEmit --strict` | **clean** |
| Go cross-compile | `GOOS=darwin GOARCH=arm64 go build` | **both modules OK** |
| **Live SSH against kooshas-laptop** | `go test -tags integration -run TestRealSSHRoundTrip` | **5/5 pass** |

### The live SSH test is the strongest evidence here

`sshtransport/integration_test.go` dials the real MacBook over Tailscale and
asserts: host key verification rejects a key absent from known_hosts, the remote
platform is Darwin (confirming the shipping target), a non-zero exit status
arrives as a result rather than a transport error, stderr is captured
separately, and a cancelled command returns promptly instead of hanging.

It found two bugs that the fake-dialer tests could not, because both depend on
real `known_hosts` contents and a real address form:

1. **Every connection would have been rejected.** The dialer hands the callback
   `host:port`, while OpenSSH records port 22 as a bare hostname, so no entry
   ever matched.
2. **Verification aborted before finding the right key.** The callback returned
   at the first hostname match. `known_hosts` routinely holds several entries per
   host after a rotation, so a stale entry shadowed the valid one.

It also revealed a missing design element: Go's SSH client does not read
`~/.ssh/config`, so dialing the Tailscale alias reaches a host whose key is
recorded under the FQDN. Added `Target.HostKeyAlias`, mirroring OpenSSH.

Two further defects were found by checks that are not tests at all: `gofmt -l`
flagged four Go files, and `tsc --strict` caught `CString` being called without
`new`, which would have thrown on every string-returning native call. The bun
test could not catch that one, since `readCString` is never reached unless a
native library loads. `tsc` is now wired into CI for that reason.


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

**Verified by execution:**

- Zig PTY layer: builds on macOS arm64, and 29/29 tests pass, including a real
  `/bin/sh` spawn, a window-size round trip through the kernel, and exit-status
  reporting. The C ABI is exercised through `dlopen` the same way Bun reaches it,
  and the built artifact exports exactly the 15 symbols the bridge looks up.
- **The full path works end to end, all the way to the renderer.** The terminal
  store owns one PTY per terminal and the chain runs store -> `pty-session.ts` ->
  FFI bridge -> Zig -> kernel, with output published back to subscribers for
  xterm. Verified by `terminal.store.test.ts` (9/9 on macOS, 8 of which also run
  on Windows), `pty_session.test.ts` (5/5) and `pty_live.test.ts` (3/3), all
  against a real shell.
- Driving that layer found a **memory-corruption bug**: the handle's index mask
  had drifted from its bit layout, so reusing a slot indexed the ring array out
  of bounds. It only appeared on the second spawn in a process, which is why the
  Zig tests, the C ABI check and the bridge test all missed it. A regression test
  now spawns and destroys four times in one pool.
- Rust persistence now **compiles and runs**: 9 tests pass against real SQLite,
  covering schema creation, message ordering, FTS5 search and its no-match case,
  token aggregation, NUL handling and null arguments. Toolchain installed into
  `/tmp/rust` on the MacBook, so nothing was installed system-wide. Its first run
  found a null-deref that would have segfaulted the host process.
- Go orchestrator, device manager, and SSH transport: 65 tests, `go vet` clean,
  `gofmt` clean, cross-compiles for darwin/arm64. The SSH path was exercised
  against the real MacBook: 5/5, including host-key rejection and prompt
  cancellation.
- TypeScript FFI bridge: FFI suite 4 pass / 0 fail, `tsc --strict` clean under
  the repo's own config, and a static check that all 43 symbols across the four
  native packages match the bridge's tables.

**Not verified:**

- Mojo is a sketch with its known defects named in the file header. There is no
  MAX toolchain, and the TypeScript bridge does not load it, so nothing shipped
  depends on it.
- The cgo link step: the Go shared libraries have never been linked. A C
  toolchain is needed, and the development host has none. Their logic is covered
  by 65 tests, but the cgo shims themselves are uncompiled.
- The terminal store drives a real PTY, but `TerminalPanel.tsx` has not been
  updated to subscribe to it or to report resizes. Until then no UI surface has
  actually rendered shell output, even though the path underneath is proven.
- The CI workflow has never run on a runner.

**A caution about this file.** Every defect found this session came from running
something that could disagree with the author. None came from the tests written
first, and several were defects in the verification itself:

1. A constant assertion compared a computed value against a literal derived the
   same way. It could not fail, and the constant it "proved" was used by an ioctl
   that was returning ENOTTY.
2. A cache-reset helper cleared the wrong cache, so a test passed standalone and
   failed in a suite. Caught only by running it both ways.
3. A root cause was asserted from two coincidentally equal failure durations and
   was disproved by one experiment.
4. A test asserted that the helpers guard against a null pointer. They did not,
   and the assertion was never checked - the real test segfaulted.
5. A test tried to pass a string containing a NUL through the C ABI, which is
   impossible by definition, so it panicked building its own input.
6. Two packages were recorded as "cannot be tested on this host". Both could.
   The claim was never tried.

Treat any claim in this file as provisional until you have seen the command that
could have contradicted it.


---

## Toolchain acquisition: a correctly-sized corrupt archive

The first Zig download produced a file of exactly the expected size
(97,217,739 bytes) that was nonetheless **corrupt**. `tar` reported "ZIP
decompression failed" on `zig.exe`, and running the extracted binary exited
`-1073741819` (`0xC0000005`, access violation) instead of printing a version.

Cause: the monitoring wrapper spawned a second `curl -C -` onto the same file
while the first was still being written, so both asserted the same byte range
and interleaved. The size matched; the contents did not. Earlier in the same
session I had identified this exact hazard and moved to kill all writers first,
but not before a 26-second overlap had already occurred.

Two rules now enforced in `agents/sandbox/toolchains/fetch-zig-clean.cmd`:

1. Delete any partial file before a fresh attempt. Never resume onto a file an
   unverified writer may have touched.
2. Exactly one `curl`, started once. The wrapper only monitors, so re-running it
   cannot create a second writer.

And one rule for the result: **file size is not integrity.** The archive is
accepted only if `Get-FileHash -Algorithm SHA256` matches the official value
from Zig's `index.json`:

```
68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e
```

This is the same lesson as the rest of the session, in a different domain: the
check I designed (byte count) agreed with me while the artifact was unusable. A
check is only worth something when it can disagree.

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

