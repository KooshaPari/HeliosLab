# Slice-2 Durability Placeholder Contract

This repository remains slice-1 in-memory for runtime durability.

## Checkpoint Contract (deferred)
- Interface: `CheckpointStore`
- File: `apps/runtime/src/sessions/checkpoint_store.ts`
- Slice-1 behavior: placeholder only, `save()` throws `slice_2_durability_not_implemented`.

## Audit Durable Store Contract (deferred)
- Interface: `AuditDurableStore`
- File: `apps/runtime/src/audit/durable_store.ts`
- Slice-1 behavior: placeholder only, `append()` throws `slice_2_durability_not_implemented`.

## Compliance Active in Slice-1
- Retention model and enforcement hooks are active in in-memory audit sink.
- Export includes completeness fields and sensitive-field redaction.
