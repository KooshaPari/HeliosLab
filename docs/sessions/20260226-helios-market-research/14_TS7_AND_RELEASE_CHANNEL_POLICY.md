# TS7 and Release Channel Policy

Date: 2026-02-26
Status: Accepted

## Decision

Helios is `TS7-native` wherever possible.

- Prefer TypeScript 7 language features, type system features, and compiler/runtime tooling when stable in beta/RC channels.
- No deliberate downleveling to older TS baselines unless a critical dependency hard-blocks adoption.

## Package Channel Policy

Default package posture for Helios:
- prefer latest `beta` or `rc` releases
- prefer latest prerelease Bun/ElectroBun-compatible packages
- pin exact versions in lockfiles to ensure deterministic builds

## Constraints and Guardrails

1. Any prerelease adoption must include:
- owner
- rollback version
- breakage blast radius

2. Required compatibility checks before upgrade merge:
- runtime boot
- renderer path boot (`ghostty` and `rio`)
- protocol schema compatibility
- lane/session lifecycle smoke path

3. Critical-path runtime packages are upgraded in canary waves:
- Wave A: protocol and adapter layer
- Wave B: renderer and terminal integration
- Wave C: UI shell and secondary utilities

## TypeScript and Build Requirements

- TS config should target TS7-native patterns first.
- Avoid compatibility shims for old TS behavior.
- Strict type mode remains enabled.
- Runtime and UI packages share core type contracts from protocol schemas.

## Exceptions Process

If TS7-native or prerelease channel creates a hard blocker:
1. document blocker with concrete package and version
2. apply temporary pin to nearest stable version
3. create explicit unpin task with due date

## Success Criteria

- TS7-native is used in runtime and desktop packages by default.
- All major dependencies operate on latest beta/RC channels unless exception is documented.
- Rollback paths are defined for every prerelease dependency in critical runtime paths.
