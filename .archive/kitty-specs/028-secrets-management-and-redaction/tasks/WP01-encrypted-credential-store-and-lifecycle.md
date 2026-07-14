---
work_package_id: WP01
title: Encrypted Credential Store and Lifecycle
lane: "done"
dependencies: []
base_branch: main
base_commit: 052223c7b89f74b50477c7d7de87deeb43505ccf
created_at: '2026-02-27T10:27:28.911589+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 0 - Foundation
assignee: ''
agent: "claude-opus"
shell_pid: "77167"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Encrypted Credential Store and Lifecycle

## Objectives & Success Criteria

- Implement AES-256-GCM encryption with master key derived from the OS keychain.
- Deliver a per-provider+workspace scoped credential store encrypted at rest on local filesystem.
- Implement credential lifecycle: create, rotate (irrecoverable overwrite), and revoke with audit events.
- Enforce cross-provider credential isolation preventing access across provider boundaries.

Success criteria:
- Stored credentials are encrypted on disk; raw values never appear in plaintext files.
- Credential rotation overwrites previous value irrecoverably (SC-028-002).
- Cross-provider credential access is denied in 100% of isolation tests (SC-028-004).
- Every credential lifecycle action produces an audit event with correlation ID.
- Credential operations complete in < 50ms.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/028-secrets-management-and-redaction/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/028-secrets-management-and-redaction/spec.md`
- Protocol bus:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
- Provider isolation (spec 025):
  - Credential scoping aligns with provider+workspace boundaries.

Constraints:
- TypeScript + Bun runtime with Node crypto for AES-256-GCM.
- Fully offline; no remote key vault dependency (NFR-028-003).
- AES-256-GCM minimum encryption standard (NFR-028-002).
- Coverage >=85% with FR-028-001, FR-028-002, FR-028-003 traceability.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Implement AES-256-GCM encryption module with OS keychain master key

- Purpose: Provide the cryptographic foundation for credential storage.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/encryption.ts`.
  2. Implement `EncryptionService` class:
     - `encrypt(plaintext: string): Promise<EncryptedPayload>`:
       - Generate random 12-byte IV per encryption.
       - Encrypt using AES-256-GCM with master key and IV.
       - Return `{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }`.
     - `decrypt(payload: EncryptedPayload): Promise<string>`:
       - Decrypt using master key, IV, and auth tag.
       - Verify auth tag (GCM does this automatically; invalid tag throws).
       - Return plaintext string.
     - `getMasterKey(): Promise<Buffer>`:
       - Retrieve master key from OS keychain.
       - If no key exists, generate 256-bit random key and store in keychain.
       - Cache key in memory for session duration (avoid repeated keychain calls).
  3. Define `EncryptedPayload` type: `{ ciphertext: Buffer, iv: Buffer, authTag: Buffer, version: number }`.
  4. Implement OS keychain abstraction:
     - Interface: `KeychainProvider { get(service: string, account: string): Promise<Buffer | null>, set(service: string, account: string, key: Buffer): Promise<void> }`.
     - macOS implementation using `security` CLI or keychain API.
     - Fallback: file-based key storage with restrictive permissions (0600) for platforms without keychain.
  5. Key derivation: use HKDF to derive per-provider keys from master key + provider ID salt.
  6. Ensure no plaintext key material is logged or exposed in error messages.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/encryption.ts`
- Validation:
  - Encrypt/decrypt round-trip produces original plaintext.
  - Different IVs produce different ciphertexts for same plaintext.
  - Tampered ciphertext or auth tag causes decryption failure.
  - Master key is retrieved from keychain (or generated on first use).
  - Per-provider key derivation produces different keys for different providers.
  - No plaintext key material in logs or errors.
- Parallel: No.

### Subtask T002 - Implement per-provider+workspace credential store

- Purpose: Store credentials securely with provider+workspace scoping.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/credential-store.ts`.
  2. Implement `CredentialStore` class:
     - `store(providerId: string, workspaceId: string, credentialName: string, value: string): Promise<void>`:
       - Derive per-provider encryption key using HKDF.
       - Encrypt value with provider-specific key.
       - Write encrypted payload to filesystem: `<data-dir>/secrets/<providerId>/<workspaceId>/<credentialName>.enc`.
       - Use atomic write (temp + rename) to prevent partial writes.
     - `retrieve(providerId: string, workspaceId: string, credentialName: string): Promise<string>`:
       - Read encrypted payload from filesystem.
       - Decrypt with provider-specific key.
       - Return plaintext value.
     - `list(providerId: string, workspaceId: string): Promise<string[]>`:
       - List credential names for provider+workspace.
     - `delete(providerId: string, workspaceId: string, credentialName: string): Promise<void>`:
       - Remove credential file from filesystem.
       - Overwrite file content with random data before deletion (defense-in-depth).
  3. Implement scoped access enforcement:
     - All operations require both providerId and workspaceId.
     - Credential paths are deterministic: provider+workspace -> directory path.
     - No API to list credentials across providers.
  4. Handle concurrent access:
     - Use file-level locking (advisory locks) for write operations.
     - Read operations do not require locks (atomic write ensures consistency).
  5. Ensure credential files have restrictive permissions (0600).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/credential-store.ts`
- Validation:
  - Store/retrieve round-trip produces original value.
  - Credential file on disk is encrypted (not plaintext).
  - File permissions are 0600.
  - Concurrent store operations do not corrupt files.
  - List returns only credentials for specified provider+workspace.
  - Delete overwrites before removal.
- Parallel: No.

### Subtask T003 - Implement credential lifecycle operations with audit events

- Purpose: Provide create, rotate, and revoke operations with full audit trail.
- Steps:
  1. In `credential-store.ts`, implement lifecycle methods:
     - `create(providerId: string, workspaceId: string, name: string, value: string, correlationId: string): Promise<void>`:
       - Check if credential already exists; reject with error if duplicate.
       - Store credential.
       - Emit `secrets.credential.created` bus event with provider ID, workspace ID, credential name (NOT value), correlation ID.
     - `rotate(providerId: string, workspaceId: string, name: string, newValue: string, correlationId: string): Promise<void>`:
       - Verify credential exists; reject if not found.
       - Overwrite with new value (old value irrecoverable after atomic write).
       - Emit `secrets.credential.rotated` bus event.
     - `revoke(providerId: string, workspaceId: string, name: string, correlationId: string): Promise<void>`:
       - Verify credential exists.
       - Delete credential (overwrite + remove).
       - Emit `secrets.credential.revoked` bus event.
  2. Implement credential access logging:
     - Every `retrieve` call emits `secrets.credential.accessed` bus event with provider ID, workspace ID, credential name, correlation ID.
     - Access events are audit-only (do not affect operation).
  3. All bus events pass through audit sink (spec 024) for persistence.
  4. Never include credential values in bus events, logs, or error messages.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/credential-store.ts`
- Validation:
  - Create stores credential and emits event.
  - Create rejects duplicate.
  - Rotate overwrites value irrecoverably.
  - Revoke removes credential and emits event.
  - Access emits audit event.
  - No credential values in any bus event or log.
- Parallel: No.

### Subtask T004 - Implement cross-provider credential isolation enforcement

- Purpose: Prevent credential access across provider boundaries.
- Steps:
  1. In `credential-store.ts`, add isolation enforcement:
     - `retrieve` and `list` only return credentials for the specified provider+workspace.
     - There is no API to query credentials across providers.
     - Filesystem path structure enforces isolation: credentials for provider A are in a different directory than provider B.
  2. Implement isolation validation in `retrieve`:
     - Verify the requesting context's provider ID matches the credential's provider ID.
     - If mismatch: throw `CREDENTIAL_ACCESS_DENIED` error.
     - Emit `secrets.credential.access.denied` bus event with attempting provider ID, target provider ID, correlation ID.
  3. Add a `CredentialAccessContext` type:
     - `requestingProviderId: string`, `requestingWorkspaceId: string`, `correlationId: string`.
     - Pass context to all credential operations.
  4. Implement directory traversal prevention:
     - Validate provider ID and workspace ID contain no path separators or special characters.
     - Reject IDs with `..`, `/`, `\`, or null bytes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/credential-store.ts`
- Validation:
  - Credential for provider A is not accessible from provider B context.
  - Access denial emits bus event.
  - Path traversal attempts are rejected.
  - No API allows cross-provider credential enumeration.
- Parallel: Yes (after T001-T003 are stable).

### Subtask T005 - Add unit tests for encryption, credential store, lifecycle, and isolation

- Purpose: Lock credential security behavior before redaction engine is built.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/__tests__/`.
  2. Add `encryption.test.ts`:
     - Test encrypt/decrypt round-trip.
     - Test different IVs produce different ciphertexts.
     - Test tampered ciphertext throws on decrypt.
     - Test tampered auth tag throws on decrypt.
     - Test master key generation and keychain storage.
     - Test per-provider key derivation produces unique keys.
     - Test no plaintext in error messages.
  3. Add `credential-store.test.ts`:
     - Test store/retrieve round-trip.
     - Test file on disk is encrypted.
     - Test file permissions are 0600.
     - Test create rejects duplicate.
     - Test rotate overwrites irrecoverably (store, rotate, verify old value not recoverable from file).
     - Test revoke removes file after overwrite.
     - Test list returns only matching provider+workspace.
     - Test concurrent store operations.
  4. Add `credential-lifecycle.test.ts`:
     - Test create emits audit event without value.
     - Test rotate emits audit event.
     - Test revoke emits audit event.
     - Test retrieve emits access audit event.
     - Test no credential values in any bus event.
  5. Add `credential-isolation.test.ts` (SC-028-004):
     - Test cross-provider access is denied.
     - Test access denial emits bus event.
     - Test path traversal rejection (`../`, `/`, `\`).
     - Test null byte injection rejection.
     - Test no cross-provider enumeration API.
  6. Map tests to requirements:
     - FR-028-001 (encrypted store): encryption and store tests.
     - FR-028-002 (scoped access): isolation tests.
     - FR-028-003 (lifecycle): lifecycle tests.
     - FR-028-009 (access audit): access event tests.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/__tests__/encryption.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/__tests__/credential-store.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/__tests__/credential-lifecycle.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/secrets/__tests__/credential-isolation.test.ts`
- Validation:
  - All tests pass.
  - Coverage >=85% on encryption.ts and credential-store.ts.
  - FR-028-001, FR-028-002, FR-028-003, FR-028-009 each have at least one mapped test.
- Parallel: Yes (after T001-T003 are stable).

## Test Strategy

- Use temporary filesystem directories for credential storage tests.
- Mock OS keychain for encryption tests (or use test keychain).
- Bus events captured via test spy.
- Irrecoverability verified by reading raw file bytes after rotation.
- Isolation tests attempt cross-provider access with different context objects.

## Risks & Mitigations

- Risk: OS keychain API not available on all platforms.
- Mitigation: Fallback to file-based key storage with restrictive permissions; keychain abstracted behind interface.
- Risk: File permission enforcement varies by filesystem.
- Mitigation: Verify permissions in tests; warn on non-POSIX filesystems.

## Review Guidance

- Confirm AES-256-GCM is used with random IVs per encryption.
- Confirm master key comes from OS keychain, not hardcoded.
- Confirm per-provider key derivation uses HKDF with provider ID salt.
- Confirm rotation makes old value irrecoverable.
- Confirm no credential values appear in bus events, logs, or errors.
- Confirm cross-provider access is denied with path traversal prevention.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-02-27T10:27:29Z – claude-opus – shell_pid=17896 – lane=doing – Assigned agent via workflow command
- 2026-02-27T10:35:53Z – claude-opus – shell_pid=17896 – lane=planned – Deferring: starting with foundational spec 019 first
- 2026-03-01T12:17:11Z – claude-opus – shell_pid=54433 – lane=doing – Started implementation via workflow command
- 2026-03-01T12:24:06Z – claude-opus – shell_pid=54433 – lane=for_review – Encrypted credential store
- 2026-03-01T12:31:23Z – claude-opus – shell_pid=77167 – lane=doing – Started review via workflow command
- 2026-03-01T12:35:33Z – claude-opus – shell_pid=77167 – lane=done – Review passed: HKDF fixed to use native hkdfSync, path traversal guard hardened with trailing sep, chmodSync static import, secure overwrite documented as best-effort, 54 tests passing
