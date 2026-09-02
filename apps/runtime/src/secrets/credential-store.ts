import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { EncryptionService } from "./encryption.js";

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
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNSAFE_PATH_CHARACTERS = /[<>:"|?*]/;

function containsControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function validateId(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}: must be a string`);
  }
  if (value === ".") {
    throw new Error(`Invalid ${label}: must not be a collapsed path segment`);
  }
  if (
    /[. ]$/.test(value) ||
    WINDOWS_DEVICE_NAME.test(value) ||
    UNSAFE_PATH_CHARACTERS.test(value) ||
    containsControlCharacter(value)
  ) {
    throw new Error(`Invalid ${label}: contains an unsafe path segment`);
  }
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

    await this.persistCredential(providerId, workspaceId, name, value, false);
  }

  private async persistCredential(
    providerId: string,
    workspaceId: string,
    name: string,
    value: string,
    createOnly: boolean,
    expectedData?: string
  ): Promise<string> {
    const dir = this.credentialDir(providerId, workspaceId);
    mkdirSync(dir, { recursive: true });

    const payload = await this.encryption.encrypt(value, providerId);
    const data = JSON.stringify(payload);

    const finalPath = this.credentialPath(providerId, workspaceId, name);
    const tmpPath = `${finalPath}.tmp.${randomBytes(4).toString("hex")}`;

    let created = false;
    try {
      writeFileSync(tmpPath, data, { encoding: "utf8", mode: 0o600 });
      if (createOnly) {
        linkSync(tmpPath, finalPath);
        created = true;
      } else {
        if (
          expectedData !== undefined &&
          (!existsSync(finalPath) || readFileSync(finalPath, "utf8") !== expectedData)
        ) {
          throw new Error("Credential changed before rotate");
        }
        renameSync(tmpPath, finalPath);
      }
      // Ensure the published file retains the restrictive temporary-file mode.
      chmodSync(finalPath, 0o600);
    } catch (error) {
      if (created) rmSync(finalPath, { force: true });
      if (createOnly && (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new CredentialAlreadyExistsError(name);
      }
      throw error;
    } finally {
      rmSync(tmpPath, { force: true });
    }
    return data;
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

    const createdData = await this.persistCredential(providerId, workspaceId, name, value, true);
    try {
      await this.emit("secrets.credential.created", {
        providerId,
        workspaceId,
        name,
        correlationId,
      });
    } catch (auditError) {
      try {
        const path = this.credentialPath(providerId, workspaceId, name);
        if (readFileSync(path, "utf8") !== createdData) {
          throw new Error("Credential changed before create audit rollback");
        }
        await this.delete(providerId, workspaceId, name);
      } catch (rollbackError) {
        throw new AggregateError(
          [auditError, rollbackError],
          "Credential creation audit failed and rollback could not remove the credential"
        );
      }
      throw auditError;
    }
  }

  /** Rotates a credential through an atomic encrypted replacement. */
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
    const expectedData = readFileSync(path, "utf8");

    await this.emit("secrets.credential.rotated", {
      providerId,
      workspaceId,
      name,
      correlationId,
    });
    // Build the encrypted replacement before atomically swapping it into place.
    // The previous credential stays readable if encryption or persistence fails.
    await this.persistCredential(providerId, workspaceId, name, newValue, false, expectedData);
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

    const path = this.credentialPath(providerId, workspaceId, name);
    if (!existsSync(path)) {
      throw new CredentialNotFoundError(name);
    }
    const expectedData = readFileSync(path, "utf8");

    await this.emit("secrets.credential.revoked", {
      providerId,
      workspaceId,
      name,
      correlationId,
    });
    if (!existsSync(path) || readFileSync(path, "utf8") !== expectedData) {
      throw new Error("Credential changed before revoke");
    }
    await this.delete(providerId, workspaceId, name);
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
    await this.checkAccess(ctx, targetProviderId, workspaceId);

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

  private async checkAccess(
    ctx: CredentialAccessContext,
    targetProviderId: string,
    targetWorkspaceId: string
  ): Promise<void> {
    validateId("requestingProviderId", ctx.requestingProviderId);
    validateId("requestingWorkspaceId", ctx.requestingWorkspaceId);
    validateId("targetProviderId", targetProviderId);
    validateId("targetWorkspaceId", targetWorkspaceId);

    if (
      ctx.requestingProviderId !== targetProviderId ||
      ctx.requestingWorkspaceId !== targetWorkspaceId
    ) {
      await this.emit("secrets.credential.access.denied", {
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
