import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { EncryptionService } from "./encryption.js";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialAccessContext {
  requestingProviderId: string;
  requestingWorkspaceId: string;
  correlationId: string;
}

export class CredentialAccessDeniedError extends Error {
  readonly code = "CREDENTIAL_ACCESS_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "CredentialAccessDeniedError";
  }
}

export class CredentialAlreadyExistsError extends Error {
  readonly code = "CREDENTIAL_ALREADY_EXISTS";
  constructor(name: string) {
    super(`Credential '${name}' already exists`);
    this.name = "CredentialAlreadyExistsError";
  }
}

export class CredentialNotFoundError extends Error {
  readonly code = "CREDENTIAL_NOT_FOUND";
  constructor(name: string) {
    super(`Credential '${name}' not found`);
    this.name = "CredentialNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = ["..", "/", "\\", "\0"];

function validateId(label: string, value: string): void {
  for (const pat of FORBIDDEN_PATTERNS) {
    if (value.includes(pat)) {
      throw new Error(`Invalid ${label}: contains forbidden character sequence '${pat}'`);
    }
  }
  if (value.length === 0) {
    throw new Error(`Invalid ${label}: must not be empty`);
  }
}

// ---------------------------------------------------------------------------
// CredentialStore
// ---------------------------------------------------------------------------

export class CredentialStore {
  private readonly encryption: EncryptionService;
  private readonly dataDir: string;
  private readonly bus: LocalBus | null;

  /**
   * @param dataDir  Root data directory. Credentials are stored under
   *                 `<dataDir>/secrets/<providerId>/<workspaceId>/<name>.enc`
   * @param bus      Optional LocalBus for emitting audit events.
   * @param encryption  Optional EncryptionService (allows injection in tests).
   */
  constructor(opts: { dataDir: string; bus?: LocalBus; encryption?: EncryptionService }) {
    this.dataDir = opts.dataDir;
    this.bus = opts.bus ?? null;
    this.encryption = opts.encryption ?? new EncryptionService();
  }

  // -------------------------------------------------------------------------
  // Low-level CRUD
  // -------------------------------------------------------------------------

  /**
   * Encrypts and writes a credential to disk.
   * Uses atomic write (temp file + rename) and sets 0600 permissions.
   */
  async store(providerId: string, workspaceId: string, name: string, value: string): Promise<void> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    const dir = this.credentialDir(providerId, workspaceId);
    mkdirSync(dir, { recursive: true });

    const payload = await this.encryption.encrypt(value, providerId);
    const data = JSON.stringify(payload);

    const finalPath = this.credentialPath(providerId, workspaceId, name);
    const tmpPath = `${finalPath}.tmp.${randomBytes(4).toString("hex")}`;

    writeFileSync(tmpPath, data, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, finalPath);
    // Ensure permissions even after rename (some platforms reset on rename)
    chmodSync(finalPath, 0o600);
  }

  /**
   * Reads and decrypts a credential from disk.
   */
  async retrieve(providerId: string, workspaceId: string, name: string): Promise<string> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    const path = this.credentialPath(providerId, workspaceId, name);
    if (!existsSync(path)) {
      throw new CredentialNotFoundError(name);
    }

    const raw = readFileSync(path, "utf8");
    const payload = JSON.parse(raw) as Parameters<EncryptionService["decrypt"]>[0];
    return this.encryption.decrypt(payload, providerId);
  }

  /**
   * Lists credential names for a provider+workspace scope.
   */
  list(providerId: string, workspaceId: string): string[] {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);

    const dir = this.credentialDir(providerId, workspaceId);
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter(f => f.endsWith(".enc"))
      .map(f => f.slice(0, -4)); // strip ".enc"
  }

  /**
   * Overwrites the credential file with random data before removing it
   * to prevent forensic recovery.
   */
  async delete(providerId: string, workspaceId: string, name: string): Promise<void> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    const path = this.credentialPath(providerId, workspaceId, name);
    if (!existsSync(path)) {
      throw new CredentialNotFoundError(name);
    }

    /**
     * Best-effort overwrite with random bytes before deletion.
     * Note: on modern SSDs, APFS, and other copy-on-write filesystems this
     * app-level overwrite is NOT guaranteed to erase the underlying sectors.
     * AES-256-GCM encryption is the primary data-protection mechanism; the
     * overwrite here is a defence-in-depth measure only.
     */
    const size = statSync(path).size;
    const noise = randomBytes(Math.max(size, 64));
    writeFileSync(path, noise, { mode: 0o600 });

    rmSync(path);
  }

  // -------------------------------------------------------------------------
  // Lifecycle operations (T003)
  // -------------------------------------------------------------------------

  /**
   * Creates a credential. Rejects duplicates.
   */
  async create(
    providerId: string,
    workspaceId: string,
    name: string,
    value: string,
    correlationId: string
  ): Promise<void> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    const path = this.credentialPath(providerId, workspaceId, name);
    if (existsSync(path)) {
      throw new CredentialAlreadyExistsError(name);
    }

    await this.store(providerId, workspaceId, name, value);
    await this.emit("secrets.credential.created", {
      providerId,
      workspaceId,
      name,
      correlationId,
    });
  }

  /**
   * Rotates a credential by overwriting irrecoverably (secure delete + rewrite).
   */
  async rotate(
    providerId: string,
    workspaceId: string,
    name: string,
    newValue: string,
    correlationId: string
  ): Promise<void> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    const path = this.credentialPath(providerId, workspaceId, name);
    if (!existsSync(path)) {
      throw new CredentialNotFoundError(name);
    }

    /**
     * Best-effort overwrite with random bytes before writing the new value.
     * Note: on modern SSDs, APFS, and other copy-on-write filesystems this
     * app-level overwrite is NOT guaranteed to erase the underlying sectors.
     * AES-256-GCM encryption is the primary data-protection mechanism; the
     * overwrite here is a defence-in-depth measure only.
     */
    const size = statSync(path).size;
    const noise = randomBytes(Math.max(size, 64));
    writeFileSync(path, noise, { mode: 0o600 });

    // Now write the new value
    await this.store(providerId, workspaceId, name, newValue);
    await this.emit("secrets.credential.rotated", {
      providerId,
      workspaceId,
      name,
      correlationId,
    });
  }

  /**
   * Revokes (deletes) a credential.
   */
  async revoke(
    providerId: string,
    workspaceId: string,
    name: string,
    correlationId: string
  ): Promise<void> {
    validateId("providerId", providerId);
    validateId("workspaceId", workspaceId);
    validateId("name", name);

    await this.delete(providerId, workspaceId, name);
    await this.emit("secrets.credential.revoked", {
      providerId,
      workspaceId,
      name,
      correlationId,
    });
  }

  /**
   * Retrieves a credential within an access context.
   * Verifies that the requesting provider matches the credential's owner.
   */
  async retrieveWithContext(
    ctx: CredentialAccessContext,
    targetProviderId: string,
    workspaceId: string,
    name: string
  ): Promise<string> {
    this.checkAccess(ctx, targetProviderId, workspaceId);

    const value = await this.retrieve(targetProviderId, workspaceId, name);
    await this.emit("secrets.credential.accessed", {
      providerId: targetProviderId,
      workspaceId,
      name,
      correlationId: ctx.correlationId,
      requestingProviderId: ctx.requestingProviderId,
    });
    return value;
  }

  // -------------------------------------------------------------------------
  // Cross-provider isolation (T004)
  // -------------------------------------------------------------------------

  private checkAccess(
    ctx: CredentialAccessContext,
    targetProviderId: string,
    targetWorkspaceId: string
  ): void {
    validateId("requestingProviderId", ctx.requestingProviderId);
    validateId("requestingWorkspaceId", ctx.requestingWorkspaceId);
    validateId("targetProviderId", targetProviderId);
    validateId("targetWorkspaceId", targetWorkspaceId);

    if (
      ctx.requestingProviderId !== targetProviderId ||
      ctx.requestingWorkspaceId !== targetWorkspaceId
    ) {
      // Fire-and-forget the denied event; we throw synchronously
      void this.emit("secrets.credential.access.denied", {
        requestingProviderId: ctx.requestingProviderId,
        requestingWorkspaceId: ctx.requestingWorkspaceId,
        targetProviderId,
        targetWorkspaceId,
        correlationId: ctx.correlationId,
      });
      throw new CredentialAccessDeniedError(
        `Provider '${ctx.requestingProviderId}' is not allowed to access credentials of provider '${targetProviderId}'`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  private secretsRoot(): string {
    return join(this.dataDir, "secrets");
  }

  private credentialDir(providerId: string, workspaceId: string): string {
    const dir = resolve(join(this.secretsRoot(), providerId, workspaceId));
    const root = resolve(this.secretsRoot());
    // Require trailing separator so that a root like /foo/bar does not
    // incorrectly accept /foo/bar-evil as a child path.
    if (!dir.startsWith(root + sep) && dir !== root) {
      throw new Error("Path traversal detected");
    }
    return dir;
  }

  private credentialPath(providerId: string, workspaceId: string, name: string): string {
    return join(this.credentialDir(providerId, workspaceId), `${name}.enc`);
  }

  // -------------------------------------------------------------------------
  // Bus helpers
  // -------------------------------------------------------------------------

  private async emit(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (this.bus === null) return;
    const envelope: LocalBusEnvelope = {
      id: `secrets:${topic}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    };
    await this.bus.publish(envelope);
  }
}
