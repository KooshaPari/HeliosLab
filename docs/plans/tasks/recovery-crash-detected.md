# F5 — Public `recovery.crash.detected` bus topic + contract test

**Branch:** `wbs/recovery-crash-topic` (deleted on merge)
**PR:** [#207](https://github.com/KooshaPari/HeliosLab/pull/207)
**Merged:** `5dcfd385` on 2026-09-24
**Worktree:** `C:\Users\koosh\agents\sandbox\f5-recovery-topic`
**Slice:** 6 (WBS follow-up ladder), F5 (slice-2 follow-up)
**Traces to:** F5 in `docs/plans/WBS.md`

---

## Problem

The slice-2 wiring internally subscribes to the watchdog's crash
event via `Watchdog.onCrashDetected(callback)` and routes it through
`CrashLoopDetector` → `SafeMode`. That internal path is fully covered
by `apps/runtime/src/recovery/__tests__/durability-layer.test.ts`.

External consumers (telemetry, dashboards, third-party agents) do not
have access to `Watchdog.onCrashDetected` — they only see the bus API.
Until this slice, the `recovery.crash.detected` event was published
to the bus but no `bus.subscribe()` consumer could actually receive
it:

```ts
// apps/runtime/src/protocol/bus/emitter.ts (BEFORE F5)
subscribe(
  _topic: string,
  _handler: (evt: EventEnvelope) => void | Promise<void>,
): () => void {
  return () => {};   // ← stub. Handlers never invoked.
}
```

The `CommandBusImpl` (used by `bus.test.ts` / `topics.test.ts`) had a
real implementation, but `InMemoryLocalBus` — the bus the runtime
*actually* hands to `DurabilityLayer` — had a stub.

## What F5 ships

1. **`InMemoryLocalBus.subscribe()`** now mirrors `CommandBusImpl`:
   handlers are stored in a `Map<topic, Array<{ handler, removed }>>`
   and the returned unsubscribe handle removes them. A `"*"` topic acts
   as an all-topics subscription, which `BusAuditSubscriber` already
   assumed but never got while `subscribe()` was a stub.
2. **`InMemoryLocalBus.publish()`** delivers each accepted event to
   matching topic subscribers *after* the existing eventLog + auditLog
   pushes, on **both** the lifecycle-start branch and the main branch.
   The dispatch is extracted into `dispatchToSubscribers()` so start
   topics (which take an early `return`) cannot silently bypass it.
3. **`emitter.test.ts`** (9 tests) pins the bus-level dispatch contract
   directly. See the contract table below.
4. **`recovery-bus-topic.test.ts`** (9 tests) asserts the crash topic
   contract end-to-end through the watchdog.

## Dispatch contract

| Guarantee | Mechanism |
|-----------|-----------|
| Exact-topic subscribers receive the event | `subscribers.get(topic)` |
| `"*"` subscribers receive every event | `subscribers.get(WILDCARD_TOPIC)`, fanned in after exact-topic handlers |
| Handlers are snapshotted before iteration | `snapshot` array built from handler references, so unsubscribing mid-dispatch cannot skip or reorder delivery (FR-010) |
| Synchronous throws are isolated | `try { … } catch {}` around each handler (FR-009) |
| Rejected promises are isolated | `void result.catch(() => {})` rejection sink (FR-009) |
| **Promise-returning handlers are NOT awaited** | `publish()` must never block on a subscriber. `Watchdog.handleCrash()` awaits `publish()` *before* it records the crash with the durability layer, so a subscriber whose promise never settles (stalled telemetry I/O) would otherwise stall crash recovery entirely. Handlers are still invoked synchronously. |
| Each subscriber gets a detached envelope | `structuredClone(baseEnvelope)` per handler, so a consumer mutating `payload` cannot rewrite what later subscribers see, nor what `getEvents()` / `getAuditRecords()` retain |
| `id` and `ts` are forwarded | Consumers need them to correlate deliveries without re-reading the event log. `EventEnvelope` does not declare them, so a local `DeliveredEventEnvelope` intersection type is used rather than widening the shared interface. |
| `destroy()` drops all subscriptions | `this.subscribers.clear()` |

`timestamp` is intentionally **not** forwarded: `LocalBusEnvelope` types
it as epoch milliseconds, but `validateEnvelope` only accepts an ISO-8601
string for that field, so no accepted event can carry a numeric one.

## Crash-topic contract test

`recovery-bus-topic.test.ts` asserts:

- A heartbeat-timeout crash reaches
  `bus.subscribe("recovery.crash.detected", …)` with the correct
  `CrashEvent` payload.
- A non-graceful exit (code 1) is delivered.
- Graceful exit (code 0) and SIGTERM are **not** delivered.
- SIGKILL is delivered with `reason: "SIGNAL"`, `signal: "SIGKILL"`.
- Sequence numbers increase monotonically across consecutive crashes.
- Delivery to bus subscribers happens **before** internal
  `watchdog.onCrashDetected` callbacks run, proving the dispatch is
  synchronous with `publish()` rather than deferred.
- The unsubscribe handle stops further deliveries.
- A throwing subscriber does not break delivery to others (FR-009).
- Subscribers of `recovery.safemode.entered` do not receive crash events
  (topic isolation).

## Why this is the right scope

- The original WBS note for F5 called this a "contract test asserting
  subscriber-receives-after-watchdog-detection." That contract was
  vacuous without the bus plumbing to make it true. F5 fixes the
  plumbing **and** pins the contract.
- `DurabilityLayer`'s internal `Watchdog.onCrashDetected(callback)`
  wiring is preserved unchanged. The public surface (bus API) is
  additive.
- No new required check on `main`. The contract test is enforced
  by the existing `Runtime Contract Tests` workflow.

## Files touched

| File | Change |
|------|--------|
| `apps/runtime/src/protocol/bus/emitter.ts` | `subscribe()` stub → real handler registry with `"*"` support. `publish()` dispatches to subscribers via the new `dispatchToSubscribers()` on both the start-topic branch and the main branch. Handlers are not awaited, errors are isolated, and each gets a detached envelope carrying `id`/`ts`. `destroy()` clears the registry. |
| `apps/runtime/src/protocol/bus/emitter.test.ts` | **New.** 9 tests pinning the bus-level dispatch contract. Also satisfies the `Constitution Compliance Validation` "Test Coverage" rule, which requires a colocated or mirrored test for each changed `.ts` source file. |
| `apps/runtime/src/recovery/__tests__/recovery-bus-topic.test.ts` | 8 tests plus a 9th asserting bus-subscriber-before-internal-handler ordering. |
| `docs/plans/WBS.md` | F5 row updated from `pending` → `merged` ([#207](https://github.com/KooshaPari/HeliosLab/pull/207), `5dcfd385`). |
| `docs/plans/tasks/recovery-crash-detected.md` | This file. |

## Files **not** touched

- `apps/runtime/src/recovery/durability_layer.ts` — internal wiring
  via `Watchdog.onCrashDetected(callback)` is unchanged. Refactoring
  `DurabilityLayer` to subscribe via `bus.subscribe()` would be
  cleaner but is out of scope for a slice-6 follow-up.
- `apps/runtime/src/recovery/safe-mode.ts` — same reason. Internal
  wiring unchanged. The bus API for `recovery.safemode.entered` and
  `recovery.safemode.exited` works automatically as a side-effect of
  the `publish()` change.
- `apps/runtime/src/protocol/bus/types.ts` — unchanged. `EventEnvelope`
  gained no new fields; the `id`/`ts` delivery is handled with a local
  intersection type in `emitter.ts`.
- `apps/runtime/src/protocol/bus/command-bus.ts` — already had the
  correct implementation. Note it *does* await subscriber promises
  (line 242), which is the P1 hazard F5 fixed on `InMemoryLocalBus`.
  Aligning the two is a follow-up.

## Verification

All run on the branch head, after `biome check --write`:

| Check | Result |
|-------|--------|
| `bun test apps/runtime/src/protocol/bus/emitter.test.ts` | **9 pass, 0 fail** |
| `bun test apps/runtime/src/recovery/__tests__/recovery-bus-topic.test.ts` | **9 pass, 0 fail** |
| `bun test apps/runtime/src/recovery apps/runtime/src/protocol` | **172 pass, 0 fail** |
| `bun run typecheck` (tsc --noEmit) | clean |
| `bunx --package=@biomejs/biome@2.5.11 biome check --write <changed files>` | clean, no fixes on final pass |
| `bun run scripts/gate-static-analysis.ts` | **PASS, 0 findings** |
| `bun run scripts/compliance-checker.ts --json <changed files>` | **passed: true, 0 findings** |
| `bun test` (full repo, 3146 tests) | **3093 pass, 18 fail, 6 errors** — see the attribution below |

### Full-suite failure attribution

None of the 18 full-repo failures are caused by this slice. Each was
checked individually:

| Failing test | Verdict |
|--------------|---------|
| `OrphanReconciler.enforceRetention > caps a single call at MAX_RETENTION_DELETIONS_PER_CALL` | **Pre-existing flake.** I/O-bound: the test creates `MAX_RETENTION_DELETIONS_PER_CALL + 50` files on disk. It passes in 738ms when the machine is quiet and times out at 5s under parallel load. It imports only `checkpoint.js` and `orphan-reconciler.js`, never the bus. |
| `Durability layer integration (slice 3)` (7 tests) | **Pre-existing flake, load-sensitive.** All 9 tests in this file pass on both `main` and this branch when run in isolation. Under the full 298-file parallel run they each exceed the 5s per-test timeout. `main` also produced a one-off real assertion failure in the SafeMode test on an earlier isolated run, confirming the file is timing-fragile independent of this change. |
| `vitepress config exists` | **Pre-existing.** Reproduces on `main` at `d6e23f37`. |
| `Worktree helpers > computeWorktreePath joins correctly` | Pre-existing, path-separator dependent on Windows. |
| `Latency Benchmarks`, `Ghostty Capabilities`, `Performance` (3 tests) | Pre-existing timing assertions. |

The F5-relevant suites are stable and fully green:

```
bun test apps/runtime/src/recovery apps/runtime/src/protocol
  172 pass, 0 fail
```

## Mutation testing

11 mutations were applied to `emitter.ts`, each reintroducing one
behavioral bug, and each was required to cause at least one test to
fail. **All 11 were caught** (0 escaped).

| # | Mutation | Result |
|---|----------|--------|
| M1 | `await` subscribers instead of detaching them (reintroduces the P1 hang) | CAUGHT (1 fail) |
| M2 | Start topics skip dispatch (the original P2 bug) | CAUGHT (1 fail) |
| M3 | Main branch skips dispatch | CAUGHT (14 fail) |
| M4 | Drop `id` from the delivered envelope | CAUGHT (2 fail) |
| M5 | Drop `ts` from the delivered envelope | CAUGHT (1 fail) |
| M6 | Share one envelope instead of cloning per subscriber | CAUGHT (1 fail) |
| M7 | No `"*"` wildcard routing | CAUGHT (1 fail) |
| M8 | `destroy()` becomes a no-op | CAUGHT (1 fail) |
| M9 | `unsubscribe()` stops splicing the entry out | CAUGHT (2 fail) |
| M10 | Synchronous subscriber errors escape `publish()` | CAUGHT (1 fail) |
| M11 | No snapshot (iterate the live list) | CAUGHT (1 fail) |

Two mutations initially escaped during harness development and drove real
test improvements rather than harness tweaks:

- **M8 (destroy)** escaped because the original test unsubscribed before
  calling `destroy()`, leaving nothing to clear. The test now registers a
  fresh subscriber before `destroy()`.
- **M6 (shared envelope)** initially had no test at all. A dedicated
  "does not alias the logged envelope" test was added.

## Review threads addressed

Six review threads were open on the first push. All are resolved by the
changes above:

| Thread | Finding | Resolution |
|--------|---------|------------|
| P1 ×2 (`emitter.ts:240`) | Awaiting a subscriber promise that never settles hangs `publish()`, and therefore stalls crash recovery | Handlers are invoked but not awaited; a rejection sink isolates async failures (M1) |
| P2 ×2 (`emitter.ts:205`) | Start topics return before reaching the dispatch block, so subscribers silently miss operation starts | Dispatch extracted to `dispatchToSubscribers()` and called on both branches (M2, M3) |
| Data integrity (`emitter.ts:221`) | Reconstructed envelope drops `id` and `ts`, blocking correlation | `id`/`ts` forwarded via `DeliveredEventEnvelope` (M4, M5) |
| Maintainability (`recovery-bus-topic.test.ts:153`) | Increasing sequence numbers does not prove synchronous delivery | New test records the order of a bus subscriber versus a `watchdog.onCrashDetected` callback and asserts subscriber-first |

Additionally, CodeAnt flagged that a subscriber could mutate retained
audit records. Each subscriber now receives its own `structuredClone`
(M6).

## Post-merge follow-ups (out of scope here)

1. **Align `CommandBusImpl.publish()` with the no-await contract.**
   `command-bus.ts:242` still does `await handler(event)`, so a hanging
   subscriber stalls the command bus. `InMemoryLocalBus` no longer has
   that hazard; the two implementations should agree.
2. **Refactor `DurabilityLayer` to subscribe via the bus.** Today the
   layer wires `Watchdog.onCrashDetected(callback)` directly. A future
   slice could migrate this to `bus.subscribe("recovery.crash.detected", …)`
   so the public topic is the single wiring path. Not done here because
   `CrashLoopDetector.recordCrash(timestamp)` needs a number, not a
   `CrashEvent` object.
3. **`recovery.safemode.entered` / `recovery.safemode.exited` contract
   test.** Now that `subscribe()` works, those topics are also
   publicly observable. A future slice could add a `safe-mode-bus.test.ts`
   mirroring the structure of `recovery-bus-topic.test.ts`.
4. **Widen the shared `EventEnvelope` interface with `id`/`ts`.** F5 uses a
   local intersection type to avoid a cross-cutting API change.
5. **The compliance checker's reverse lookup cannot match ESM imports.**
   `testImportsSourceFile()` builds patterns like `from ['"].*emitter['"]`,
   which never match `from "./emitter.js"`. Every changed `.ts` file
   therefore needs a colocated test even when an existing test already
   imports it through the barrel. Fixing the pattern would remove that
   false positive at its source.
