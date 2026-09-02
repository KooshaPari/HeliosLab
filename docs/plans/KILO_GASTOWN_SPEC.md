# Kilo Gastown Methodology Specification

## Overview

Kilo Gastown is the agent orchestration and delegation methodology used to coordinate multi-agent development work across the heliosApp ecosystem. It provides a structured system for parallelizing tasks, tracking progress, and managing work through autonomous agents called polecats.

**Version:** 1.0  
**Status:** Active  
**Rig ID:** `35903ad7-65d2-489a-bf30-ff95018fd80f`  
**Town ID:** `78a8d430-a206-4a25-96c0-5cd9f5caf984`

---

## Core Concepts

### Convoys

A **convoy** is a batch of related work items (beads) that are dispatched together to maximize parallel execution. Convoys enable multiple agents to work simultaneously on different aspects of the same feature or project.

| Property | Description |
|---|---|
| **ID** | Unique identifier (e.g., `6d75756c-5831-406f-9d7c-bcd49be2a22a`) |
| **Feature Branch** | Git branch pattern: `convoy/<name>/<convoy-id>/head` |
| **Status** | `open`, `in_progress`, `landed`, or `cancelled` |
| **Beads** | Contains one or more work items (beads) |

### Beads

A **bead** is a single unit of work assigned to an agent. Beads are the atomic tracking entity in Kilo Gastown.

| Property | Description |
|---|---|
| **Type** | `issue` (single task) or `convoy` (batch of tasks) |
| **States** | `open` → `in_progress` → `in_review` → `closed` |
| **Assignment** | Assigned to a specific agent via `assignee_agent_bead_id` |

### Polecats

**Polecats** are autonomous agents that execute assigned beads. Each polecat operates in its own worktree and is responsible for completing its hooked (assigned) bead.

---

## Bead Lifecycle

Beads follow a defined state machine:

```
open → in_progress → in_review → closed
  ↓         ↓            ↓
blocked   blocked    (rework)
```

| State | Description |
|---|---|
| `open` | Work item created, not yet assigned or started |
| `in_progress` | Agent is actively working on the bead |
| `in_review` | Work submitted for review; awaiting merge |
| `blocked` | Work paused due to dependency or issue |
| `closed` | Work completed and merged |

### Lifecycle Transitions

1. **Assignment** — Bead is assigned to an agent via `gt_sling` or `gt_sling_batch`
2. **Hook** — Agent calls `gt_prime` to receive context and begins work
3. **Execution** — Agent implements the bead requirements
4. **Pre-submission Gates** — Agent runs quality gates (`task quality`)
5. **Submission** — Agent calls `gt_done` to push branch and transition to `in_review`
6. **Review** — Refinery reviews and either merges or requests changes
7. **Rework** (if requested) — Agent receives feedback, fixes issues, re-submits
8. **Closure** — Bead marked as `closed`

---

## Delegation Tools

### gt_sling

Delegates a single bead to an agent for immediate execution.

```
gt_sling <bead_id>
```

### gt_sling_batch

Delegates multiple beads (a convoy) to agents for parallel execution.

```
gt_sling_batch <convoy_id>
```

### gt_list_convoys

Lists all convoys in the rig with their status and progress.

```
gt_list_convoys
```

### gt_convoy_status

Shows detailed status of a specific convoy including all its beads.

```
gt_convoy_status <convoy_id>
```

---

## Merge Modes

Kilo Gastown supports two merge strategies:

### Review-Then-Land (Default)

1. Agent pushes branch and calls `gt_done`
2. Bead transitions to `in_review`
3. Refinery reviews and merges when ready
4. Bead transitions to `closed`

### Review-and-Merge

1. Agent pushes branch and calls `gt_done`
2. Bead transitions to `in_review`
3. Refinery immediately merges (no separate review queue)

---

## Branch Naming Convention

Feature branches follow the convoy pattern:

```
convoy/<project>-kilo-specs-<repo>/<convoy-id>/gt/<agent-name>/<bead-id>
```

Example:
```
convoy/agileplus-kilo-specs-heliosapp/6d75756c/gt/polecat-48/b4803254
```

---

## Pre-Submission Quality Gates

Before calling `gt_done`, agents must run:

```bash
task quality
```

This validates:
- Code correctness
- Linting and type checking
- Test passing

If any gate fails, the agent must fix the issue and re-run until passing.

---

## Integration with AgilePlus

Kilo Gastown works alongside AgilePlus for comprehensive project tracking:

| Layer | System | Tracks |
|---|---|---|
| **Orchestration** | Kilo Gastown | Agent work, parallelization, delegation |
| **Execution** | Git branches, commits | Code changes |
| **Tracking** | AgilePlus | Features, work packages, priorities |

### Cross-Reference Pattern

Spec documents include both methodologies:

```
Migrated from kitty-specs. Tracked in AgilePlus.
```

Convoy work is linked via branch naming:
- Branch → Convoy ID → AgilePlus feature

---

## Agent Workflow Summary

1. **Prime** — Call `gt_prime` to get context and hooked bead
2. **Explore** — Understand codebase structure and requirements
3. **Implement** — Write code, tests, documentation
4. **Quality Gates** — Run `task quality` and fix any failures
5. **Commit & Push** — Make focused commits; push after each
6. **Checkpoint** — Call `gt_checkpoint` after milestones
7. **Done** — Call `gt_done` with branch name; transitions bead to `in_review`

---

## CLI Reference

| Command | Purpose |
|---|---|
| `gt_prime` | Get context: agent identity, hooked bead, mail, open beads |
| `gt_sling <bead_id>` | Delegate single bead |
| `gt_sling_batch <convoy_id>` | Delegate all beads in convoy |
| `gt_done --branch <name>` | Complete work, push branch, transition to `in_review` |
| `gt_bead_status <bead_id>` | Check bead status |
| `gt_checkpoint --data <json>` | Save crash-recovery state |
| `gt_list_convoys` | List all convoys in rig |
| `gt_mail_send` | Send message to another agent |
| `gt_mail_check` | Check undelivered mail |
| `gt_escalate` | Report issue requiring human intervention |

---

## Relationship with AGENTS.md

The `AGENTS.md` file at the repository root is the authoritative agent guidance file for heliosApp, while this spec provides the broader Kilo Gastown methodology context.

| Document | Scope | Audience |
|---|---|---|
| `KILO_GASTOWN_SPEC.md` | Kilo Gastown methodology (this file) | Cross-project reference |
| `AGENTS.md` | heliosApp-specific agent guidance | All agents working in this rig |

AGENTS.md includes:
- Kilo Gastown identity (rig ID, town ID, convoy)
- Delegation tool usage specific to heliosApp
- heliosApp development commands (`bun run typecheck`, `bun run gates`, etc.)
- Stack info and project structure
- Code conventions specific to heliosApp
- Agent behavior rules for this rig

This spec provides the methodology foundation; AGENTS.md applies it to heliosApp's specific tooling and conventions.

---

## Related Documentation

| Document | Purpose |
|---|---|
| `AGENTS.md` | heliosApp-specific agent guidance and tooling |
| `AGILEPLUS_SPEC.md` | AgilePlus project tracking methodology |
| `PRD.md` | Product Requirements Document |
| `CHANGELOG.md` | Version history |
| `docs/specs/*/spec.md` | Individual technical specifications |

---

## Summary

Kilo Gastown provides heliosApp with:

- **Parallel execution** — Convoys enable multiple agents to work simultaneously
- **Structured delegation** — `gt_sling` and `gt_sling_batch` for work distribution
- **Bead lifecycle** — Clear state machine from `open` to `closed`
- **Quality enforcement** — Pre-submission gates ensure code quality
- **Crash recovery** — Checkpoints enable resume after container restart
- **Integration** — Works with AgilePlus for complete project tracking
