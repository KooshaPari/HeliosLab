# HeliosApp Sladge Badge Session

## Goal

Add the Sladge disclosure badge to `HeliosApp` without touching unrelated local work in the canonical checkout.

## Outcome

- Added the `AI Slop Inside` badge to the README badge block.
- Used the isolated `heliosApp-wtrees/sladge-badge` worktree because canonical `heliosApp` has an unrelated `SECURITY.md` change.
- Kept runtime, desktop shell, provider, MCP, and dependency surfaces out of scope.

