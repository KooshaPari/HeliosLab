# heliosApp to HeliosLab migration

HeliosLab is becoming the canonical home of the Helios desktop/runtime product. The
consolidation uses a history-preserving Git merge, so existing heliosApp commits remain
reachable and attributable in HeliosLab.

## Cutover checklist

- [x] Merge the complete heliosApp Git history into the HeliosLab consolidation branch.
- [x] Preserve heliosApp application, package, test, specification, and documentation paths.
- [x] Replace placeholder quality checks with blocking TypeScript, Rust, security, coverage,
  and requirement-traceability gates in HeliosLab.
- [ ] Merge the HeliosLab consolidation PR after its recorded gates are green or explicitly
  documented as blocking proper reds.
- [ ] Publish a final heliosApp migration release pointing to HeliosLab.
- [ ] Transfer open actionable issues or close them with a HeliosLab replacement link.
- [ ] Archive heliosApp only after the migration release and issue transfer are complete.

Unchecked items are intentionally blocking. They must not be marked complete without a
link to the corresponding PR, release, issue migration, or repository setting evidence.
