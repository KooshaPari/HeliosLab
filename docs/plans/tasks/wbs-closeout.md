# WBS Closeout (Slice 5 of 5)

**Status:** Implementing on `wbs/closeout`, pending PR to `main`.
**Scope:** Tie up the WBS into a single discoverable artefact, surface
the residual gaps explicitly, and unblock follow-up work that wants a
record of what the previous slices committed to.

---

## What this slice delivers

1. **`docs/plans/WBS.md`** — the consolidated five-slice Work
   Breakdown Structure: which slice did what, which commit landed
   it, which required-check it added, what's still gated only by
   humans.
2. **`docs/plans/tasks/release-evidence.md`** and
   **`docs/plans/tasks/cvp-evidence.md`** — refreshed with their
   actual current status (`MERGED`, commit SHAs, link to the WBS)
   rather than the `LANDED` / `STATUS: IN PROGRESS` text the prior
   session left them in.
3. **`docs/plans/tasks/wbs-closeout.md`** — this file.

The slice exists to keep the next session from having to reconstruct
the WBS history by reading commit messages. The five slices together
are the unit of accountability for "we promised these gates would
run on PRs and these commits would land on `main`," and a single
document is cheaper to navigate than four plan-doc files.

---

## What this slice does not deliver

- **No new CI gate.** Slice 5 is meta-work. Adding a fifth gate
  here would compete with slices 3 and 4 for visibility in
  `.github/required-checks.txt`, which is the wrong shape for a
  closeout PR.
- **No cherry-pick of `VerticalSliceDriver` / `RecordingRendererAdapter`.**
  The terminal-first work is on `wbs/terminal-slice` at 50+ commits
  ahead of `main`; absorbing it is its own slice (post-WBS follow-up).
- **No freshness gate on `cvp-1000.json`.** That is a slice 4
  follow-up, not a slice 5 deliverable — keeping follow-ups
  attributed to the slice that owns the artefact makes the WBS
  traversable.

---

## How to verify locally

```sh
# The new WBS doc is readable
cat docs/plans/WBS.md

# Status of slice 3 and 4 plan docs now reflects reality
head -10 docs/plans/tasks/release-evidence.md
head -10 docs/plans/tasks/cvp-evidence.md

# Local gates still green post-closeout
bun run scripts/gate-static-analysis.ts
bunx --package=@biomejs/biome@2.5.11 biome check docs/plans/WBS.md docs/plans/tasks/

# Format check
bun run scripts/gate-required-check-names.ts
```

---

## Workflow design notes

- **No new workflow file.** Slice 5 is docs-only; adding an empty
  `wbs-closeout.yml` would just be CI weight.
- **No required-check entry.** `wbs-closeout.yml` does not exist
  precisely so nothing new lands in `.github/required-checks.txt`.
- **No test changes.** Validator / harness unit tests stay where the
  prior slices put them.

---

## What is enforced today (post-closeout)

After this slice lands, the required-check surface is unchanged from
slice 4: `release-evidence.yml|Release Evidence`,
`cvp-evidence.yml|CVP Evidence`, plus the pre-existing `ci.yml`,
`required-check-names-guard.yml` entries.

The artefact the slice *does* add is **a discoverable, single-file
index** for the WBS, so the next coordinator / agent / human that
asks "what did the WBS plan cover?" can answer from one doc rather
than four.

---

## Recommended follow-up slices (post-WBS)

Listed in roughly the order a sane team would tackle them; not a
commitment to land them in this order.

### F1. Bring terminal-first onto `main`

Cherry-pick `VerticalSliceDriver` + `RecordingRendererAdapter` from
`origin/wbs/terminal-slice` onto `main`. Clears the gap that
prevents the CVP harness and scaling regression suite from being
absorbed.

### F2. Cherry-pick CVP harness and scaling regression

Once F1 is merged, `git checkout origin/wbs/terminal-slice -- apps/runtime/tests/cvp/`
brings over `cvp-harness.ts`, `cvp-scaling.test.ts`, `run-scaling.ts`.
Add the scaling regression suite to the default `bun test apps/runtime/tests`
gate so the harness's smaller smoke checks run on every PR. The CVP
evidence gate stays as-is (it already validates the JSON); the only
change is that the JSON's skip-on-missing behaviour becomes a hard
fail-on-missing because the harness now produces one on every PR.

### F3. Freshness gate on `cvp-1000.json`

Extend the CVP validator with a fifth check: `generatedAt` must be
within N days of HEAD. N starts at 30 days; tune once we know how
often the harness lands a real run.

### F4. Per-release `cvp-<version>.json` artefacts

Each `release:` commit on `main` publishes its own CVP evidence
file rather than overwriting `cvp-1000.json`. The validator becomes
"the most recent one matches the current VERSION." This lands in
the release-evidence gate as a sixth check.

### F5. Public `recovery.crash.detected` bus topic

Surface the watchdog's crash event as a public bus topic so
external consumers can listen. The wiring is already in place;
the slice is to publish + add a public contract test.

### F6. True fork/exec cross-process restart test

Replace the in-process two-`createRuntime` simulation with a fork
into a child process that opens its own `dataDir`, then verifies
the child saw the parent's checkpoint. Use Bun's `Bun.spawn` to
keep the test JS-only.

### F7. SBOM generation inside `release.yml`

Today the SBOM is generated by the scheduled `sbom-refresh` job,
not by the release pipeline itself. Move the SBOM generation into
`release.yml` so every release commit ships its own SBOM (the
release-evidence gate already requires that).

---

## Why these five slices, not three or seven

See `docs/plans/WBS.md`, "Why these five slices." Short version:
five is enough to convert claims (`Q7=A`) into gates (a CI job that
fails the PR if the claim is false), without expanding the WBS into
work that should be post-WBS follow-ups on the terminal-slice
branch.

---

## File map for this slice

- `docs/plans/WBS.md` — new, 215 lines
- `docs/plans/tasks/wbs-closeout.md` — this file
- `docs/plans/tasks/release-evidence.md` — refreshed status banner
- `docs/plans/tasks/cvp-evidence.md` — refreshed status banner

No code, no workflow files, no required-check changes, no test
changes.
