# HeliosApp Session Overview

Date: 2026-02-26
Session ID: 20260226-helios-market-research
Scope: Build an in-depth market/user/product research docset for a terminal-first AI IDE with minimal overhead and multi-terminal mux UX.

## Goals

- Define the product thesis for HeliosApp.
- Benchmark current offerings (Codex CLI/App direction, Claude ecosystem wrappers, terminal AI agents, orchestration lists).
- Formalize requirements into PRD artifacts, ADRs, FR/NFRs, user stories, and implementation strategy.
- Resolve ambiguous assumptions into explicit decision questions.

## Deliverables

- 01_RESEARCH.md
- 02_SPECIFICATIONS.md
- 03_DAG_WBS.md
- 04_IMPLEMENTATION_STRATEGY.md
- 05_KNOWN_ISSUES.md
- 06_TESTING_STRATEGY.md

## Locked Track (Active)

- TS strategy: `TS7-native` wherever possible
- Package strategy: latest `beta`/`rc` channels with deterministic pins
- Shell: `ElectroBun`
- Renderers: `ghostty` and `rio` behind settings feature flag
- Renderer switch behavior: hot reload when safe; otherwise fast restart with session restore
- Mux core: `zellij`
- Persistence and collaboration: `zmx`, `upterm`, and `tmate` required
- Protocol stack: `MCP` + `A2A` + internal local control bus

## Decision Snapshot

- Product positioning: "safe, explainable, terminal-native AI execution layer".
- Go-to-market wedge: power users with 8-25 concurrent terminal workloads, multi-project branch work, and strict auditability needs.
- Architecture direction now explicitly favors innovation velocity and performance experimentation.

## Open Questions to Close Next

- Exact IPC contract and event taxonomy for internal local bus.
- Renderer capability matrix and fallback behavior by OS.
- Security policy defaults for share-session features (`upterm`/`tmate`).
- Provider adapter launch set and conformance suite scope.
