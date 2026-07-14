# KILL_SWITCH — Runtime Kill Procedure

**Snapshot:** 2026-03-24. **Owner:** SRE / On-call.

## Overview
This document outlines the procedure to kill or disable risky runtime features (PTY, secrets management, remote bus) in `heliosApp`.

## Procedure

1. **Feature Flag Kill Switch:**
   - Locate `config/runtime_flags.json`.
   - Set `enabled: false` for the specific feature key (e.g., `PTY_LIFECYCLE_V2`).
   - Push to `main` or update the environment variable `HELIOS_DISABLE_<FEATURE>=true`.

2. **Emergency Process Termination:**
   - Use `helios-cli stop --all` to kill all running lanes.
   - Run `killall helios-runtime` to force terminate the local bus.

3. **Rollback:**
   - If feature flag kill fails, revert to the last stable commit:
     ```bash
     git revert -m 1 <commit_hash>
     ```

## Contact
- For PTY issues: @helios-pty-team
- For Secrets issues: @helios-security-team
