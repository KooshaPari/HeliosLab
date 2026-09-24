# F6 — True fork/exec cross-process restart test

**Branch:** `wbs/f6-fork-exec`
**Slice:** 6 (WBS follow-up ladder), F6 (slice-2 follow-up)
**Traces to:** F6 in `docs/plans/WBS.md`

---

## Problem

Slice 2 added a cross-process restart test, but it is not actually
cross-process. `create-runtime-durability.test.ts` builds two
`createRuntime({ dataDir })` lifetimes inside a single `bun test` process:

```
firstRuntime  ── close() ──▶  secondRuntime
        (same V8 isolate, same module registry, same in-memory state)
```

That proves the checkpoint file survives and that a second runtime can
read it. It does **not** prove what we actually care about after a real
crash: that a genuinely cold OS process, with no shared heap and no
warm module cache, can open the same `dataDir` and recover.

Bugs that hide in exactly that gap include stale `.tmp` debris breaking
the next write, a `.backup` never being created, checksum validation
being skipped on the cold-read path, and any accidental dependency on
module-level singletons surviving a restart.

## What F6 ships

| File | Change |
|------|--------|
| `apps/runtime/src/__tests__/create-runtime-fork-exec.test.ts` | **New.** 4 tests that spawn every runtime lifetime as a separate OS process. |
| `apps/runtime/src/__tests__/helpers/fork-exec-helper.ts` | **New.** The spawned entry point. `seed`, `recover`, and `recover-corrupt` modes. |
| `docs/plans/WBS.md` | F6 section rewritten to describe what actually landed. |

## Design

`Bun.spawnSync(["bun", HELPER, ...])` runs each lifetime. The helper
prints exactly one JSON object on stdout, so the parent test never has
to scrape logs or guess at formatting.

- **`seed`** — creates a runtime, registers a lane + session, forces a
  checkpoint, then calls `process.exit(0)` **without** `runtime.close()`.
  No graceful shutdown, no final checkpoint, no cleanup. It also leaves a
  stale `.tmp` on disk to reproduce the debris an ungraceful death leaves.
- **`recover`** — a cold process opens the same `dataDir`, confirms the
  first process's session is visible, and writes a fresh checkpoint on top.
- **`recover-corrupt`** — a cold process finds a primary checkpoint that
  is valid JSON with the right shape but a wrong checksum and a decoy
  session list. It must fall back to the `.backup` and return the real
  session.

The decoy matters. With a merely unparseable primary, `read()` rejects it
in its `catch` block and `verifyChecksum()` is never reached, so neutering
the checksum check would go unnoticed. Swapping the session list makes
"did the reader actually reject the primary?" observable from outside.

Both recovery tests assert that the pids involved are distinct from each
other and from the test process. If the first ever regresses to in-process
lifetimes, the assertion fails instead of the coverage silently evaporating.
The two failure-path tests deliberately assert no pids: they are checking
exit codes and error payloads, not process identity.

## Verification

| Check | Result |
|---|---|
| `create-runtime-fork-exec.test.ts` | 4 pass, 0 fail, 35 assertions |
| `apps/runtime/src/__tests__` + `apps/runtime/src/recovery` | 171 pass, 0 fail (167 on pristine `main` + 4 new) |
| `bunx tsc --noEmit` | clean |
| `biome check` (2 changed files) | clean, no fixes on final pass |
| `scripts/gate-static-analysis.ts` | PASS, 0 findings |

## Mutation testing

Harness mutates **production source only** (`recovery/checkpoint.ts`),
never the test file. Deleting an assertion from a passing test still
passes, so test-file mutations are meaningless by construction.

| ID | Mutation | Result |
|----|----------|--------|
| M1 | skip `cleanStaleTempFiles()` | **ESCAPED** — see below |
| M2 | skip `fsync` before rename | **ESCAPED** — see below |
| M3 | non-atomic write (no temp + rename) | caught |
| M4 | stop computing the checksum | caught |
| M5 | stop backing up the previous checkpoint | caught |
| M6 | `read()` never falls back to the backup | caught |
| M7 | `verifyChecksum()` always accepts | caught |
| M8 | `read()` returns `null` unconditionally | caught |

**6/8 caught.** The two survivors are real, and worth stating plainly:

- **M1** is unobservable by construction. `write()` calls
  `fs.writeFile(tempPath, ...)`, which truncates the same `.tmp` path the
  cleanup step would have unlinked, and the subsequent `rename` removes it
  either way. `cleanStaleTempFiles()` is redundant on the happy path. An
  early version of this test asserted "no `.tmp` remains" and passed for
  the wrong reason; that assertion is now labelled as such in the helper
  rather than presented as cleanup coverage.
- **M2** cannot be caught without simulating a power cut, which is out of
  scope for a test suite. The `fsync` is still correct and worth keeping.

Neither was addressed by weakening the test or by loosening the harness.
