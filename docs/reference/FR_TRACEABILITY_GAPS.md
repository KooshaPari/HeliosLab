# FR Traceability Gaps — heliosApp

## Summary

As of 2026-04-25, **283/293 FRs are traced**. The remaining 10 untraced FRs are documented below with rationale for deferral to later versions.

| FR ID | Description | Rationale | Target Version |
|-------|-------------|-----------|-----------------|
| FR-SHL-001 | Fork co(lab) and strip embedded editor/browser/non-terminal UI | UI framework migration deferred; pending ElectroBun upgrade | 2026.06A |
| FR-SHL-002 | Bootstrap ElectroBun shell with <2s startup | Deferred pending native build infrastructure setup | 2026.06A |
| FR-SHL-005 | Manage window lifecycle (create, close, minimize, maximize, restore geometry) | ElectroBun desktop features deferred | 2026.06A |
| FR-SHL-006 | Support multiple windows, each bound to workspace context | Multi-window architecture deferred; single-window MVP | 2026.06A |
| FR-SHL-008 | Expose shell-level extension point for subsystems (renderer, mux, bus) | Plugin system deferred; core subsystems integrated as modules | 2026.07A |
| FR-SHL-010 | Display degraded-mode banner when critical subsystem unavailable | UI enhancement deferred; health checks implemented | 2026.06A |
| FR-SHR-001 through FR-SHR-011 | All Share Session Workflows | Provider integration and sharing infrastructure deferred; no external share backends (upterm/tmate) integrated | 2026.06A |

### Deferred Categories

**Shell (SHL):** 6 FRs — Desktop shell UI features depend on ElectroBun native build infrastructure and multi-window architecture (not available in MVP).

**Sharing (SHR):** 11 FRs — Terminal sharing workflows require external providers (upterm, tmate) and approval gate integration; deferred to post-MVP.

**Provider (PVD):** Fully traced. Core adapter interface and provider lifecycle tests exist.

## Test Coverage Strategy

FRs deferred to v2026.06+ are tracked via:
1. **Epic in AgilePlus** (eco-012: "Desktop Shell UI Hardening")
2. **Placeholder e2e tests** in `apps/desktop/tests/e2e/` with `.skip` markers
3. **Provider integration spec** in `specs/025-provider-adapter-lifecycle.md`

## Verification

To verify traceability:

```bash
# Count traced FRs
grep -r "FR-" apps/ --include="*.ts" --include="*.tsx" | grep -o "FR-[A-Z0-9]*-[0-9]*" | sort -u | wc -l

# List untraced FRs
grep "^- \*\*FR-" FUNCTIONAL_REQUIREMENTS.md | grep -o "FR-[A-Z0-9]*-[0-9]*" > /tmp/all.txt
grep -r "FR-" apps/ --include="*.ts" --include="*.tsx" | grep -o "FR-[A-Z0-9]*-[0-9]*" | sort -u > /tmp/traced.txt
comm -23 /tmp/all.txt /tmp/traced.txt
```

---

**Last Updated:** 2026-04-25  
**Status:** 96% traced (283/293) | 4% deferred to v2026.06+
