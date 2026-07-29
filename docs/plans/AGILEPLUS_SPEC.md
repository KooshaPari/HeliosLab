# AgilePlus Methodology Specification

## Overview

AgilePlus is the project management methodology and tooling system used to track, coordinate, and govern all feature development in the heliosApp ecosystem. It provides structured work tracking, historical audit trails, and systematic methodology enforcement across the monorepo.

**Version:** 1.0  
**Status:** Active  
**Reference Implementation:** `$AGILEPLUS_PATH`

---

## Core Principles

### 1. Feature-Centric Work Organization

All development work is organized around **features** — discrete, deliverable units of functionality that map to product requirements. Features are the primary tracking entity in AgilePlus, containing one or more **work packages** that represent implementation tasks.

### 2. Structured Tracking vs. Ad Hoc Communication

AgilePlus enforces structured tracking over informal communication:
- All feature work must be logged in AgilePlus
- Status updates occur through the CLI, not informal channels
- Historical decisions are preserved in worklogs and git history

### 3. Methodology Enforcement Through Conventions

The methodology is enforced through consistent conventions rather than rigid process:
- Every spec document references its AgilePlus tracking
- All commits follow structured patterns linked to work packages
- Work history is preserved across repository migrations

### 4. Separation of Concerns

AgilePlus maintains strict separation between:
- **Planning layer** — Feature definitions, work packages, priorities
- **Execution layer** — Git branches, commits, pull requests
- **Audit layer** — Worklogs, history, retrospectives

---

## AgilePlus in heliosApp

### Project Configuration

The heliosApp project is configured to use AgilePlus for all work tracking:

| Configuration | Value |
|---|---|
| **Reference Path** | `$AGILEPLUS_PATH` |
| **Database** | `.agileplus/agileplus.db` |
| **Work Audit** | `.work-audit/worklog.md` |
| **CLI Entry Point** | `agileplus` (run from AgilePlus directory) |

### Feature Tracking

All feature development for heliosApp is tracked in AgilePlus:

```
export AGILEPLUS_PATH=<path-to-agileplus>
cd $AGILEPLUS_PATH

# List all features
agileplus list

# Show feature details
agileplus show <feature-id>

# Update work package status
agileplus status <feature-id> --wp <wp-id> --state <state>
```

### Spec Migration Convention

When specs are created or migrated for heliosApp, they follow this convention:

```
Migrated from kitty-specs. Tracked in AgilePlus.
```

This line appears in all spec documents under `docs/specs/*/spec.md` to ensure traceability between documentation and work tracking.

---

## Work Package Workflow

### States

Work packages in AgilePlus follow a defined state machine:

| State | Description |
|---|---|
| `open` | Initial state, work not yet started |
| `in_progress` | Actively being worked on |
| `in_review` | Submitted for review |
| `blocked` | Work paused due to dependency or issue |
| `done` | Completed and merged |
| `cancelled` | Work cancelled |

### Lifecycle

1. **Feature Creation** — A feature is created in AgilePlus with associated work packages
2. **Work Assignment** — Work packages are assigned priority and state
3. **Execution** — Agent or developer works on the feature branch
4. **Status Updates** — Work package state is updated via AgilePlus CLI
5. **Review** — Changes are reviewed and merged
6. **Closure** — Work package marked as `done`

---

## Integration with heliosApp Architecture

### Spec-to-Work Mapping

Each technical specification in `docs/specs/` corresponds to one or more AgilePlus features:

| Spec Directory | Purpose | AgilePlus Tracking |
|---|---|---|
| `docs/specs/001-colab-agent-terminal-control-plane/` | Core terminal control | Tracked in AgilePlus |
| `docs/specs/002-local-bus-v1-protocol-and-envelope/` | LocalBus protocol | Tracked in AgilePlus |
| `docs/specs/003-workspace-and-project-metadata-persistence/` | Persistence layer | Tracked in AgilePlus |
| ... | ... | ... |

### Branch Naming Convention

Feature branches follow the convoy pattern, linking git work to AgilePlus work:

```
convoy/agileplus-kilo-specs-heliosapp/<convoy-id>/head
```

This allows traceability from branch → convoy → AgilePlus feature.

### Commit Hygiene

Commits maintain a link to work items:
- Descriptive commit messages reference feature context
- Frequent commits on feature branches
- Push after every commit (ephemeral container)

---

## AgilePlus CLI Reference

### Quick Commands

```bash
export AGILEPLUS_PATH=<path-to-agileplus>
cd $AGILEPLUS_PATH

# List all features
agileplus list

# Show feature details and work packages
agileplus show <feature-id>

# Update work package status
agileplus status <feature-id> --wp <wp-id> --state <state>

# List work packages for a feature
agileplus wp list <feature-id>

# Create a new work package
agileplus wp create <feature-id> --title "<title>" --priority <priority>
```

### Status States

When updating work package state:

| State Flag | Meaning |
|---|---|
| `--state open` | Not started |
| `--state in_progress` | In active development |
| `--state in_review` | Submitted for review |
| `--state blocked` | Blocked by dependency |
| `--state done` | Completed and merged |
| `--state cancelled` | Cancelled |

---

## Related Documentation

| Document | Purpose |
|---|---|
| `worklog.md` | Project-level worklog referencing AgilePlus |
| `PLAN.md` | 8-phase implementation plan |
| `PRD.md` | Product Requirements Document |
| `docs/specs/*/spec.md` | Individual technical specifications |

---

## Migration History

The heliosApp specs were migrated from `kitty-specs` to AgilePlus tracking. All spec documents maintain the notation:

```
Migrated from kitty-specs. Tracked in AgilePlus.
```

This ensures backward traceability for historical decision context while maintaining current methodology compliance.

---

## Summary

AgilePlus provides heliosApp with:

- **Centralized work tracking** — All features and work packages in one system
- **CLI-driven workflow** — Structured commands over informal communication
- **Audit trail** — Work history preserved in `.work-audit/worklog.md`
- **Traceability** — Specs link to features, branches link to convoys
- **Methodology consistency** — Enforced through conventions across the monorepo
