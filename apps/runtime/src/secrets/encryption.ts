import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string; // hex, 12 bytes
  authTag: string; // hex, 16 bytes
  version: number; // always 1
}

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;

const KEYCHAIN_SERVICE = "helios.master.key";
const KEYCHAIN_ACCOUNT = "helios";

function validateMasterKey(value: unknown, source: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== KEY_BYTES) {
    throw new Error(`Invalid ${source}: master key must be exactly ${KEY_BYTES} bytes`);
  }
  return value;
}

function parseMasterKeyHex(value: string, source: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid ${source}: master key must contain exactly 64 hexadecimal characters`);
  }
  return validateMasterKey(Buffer.from(value, "hex"), source);
}

function validateEncryptedPayload(value: unknown): EncryptedPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid encrypted payload: expected an object");
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.version !== "number" ||
    !Number.isInteger(payload.version) ||
    typeof payload.ciphertext !== "string" ||
    !/^(?:[0-9a-fA-F]{2})*$/.test(payload.ciphertext) ||
    typeof payload.iv !== "string" ||
    !/^[0-9a-fA-F]{24}$/.test(payload.iv) ||
    typeof payload.authTag !== "string" ||
    !/^[0-9a-fA-F]{32}$/.test(payload.authTag)
  ) {
    throw new Error("Invalid encrypted payload: fields do not match the persisted schema");
  }

  return payload as unknown as EncryptedPayload;
}

export class EncryptionService {
  private masterKeyCache: Buffer | null = null;
  private keyPath: string;
  // For testing: allow injection of a master key getter
  private masterKeyOverride: (() => Promise<Buffer>) | null = null;

  constructor(opts?: { masterKeyOverride?: () => Promise<Buffer>; keyPath?: string }) {
    this.keyPath = opts?.keyPath ?? join(homedir(), ".helios", "master.key");
    if (opts?.masterKeyOverride) {
      this.masterKeyOverride = opts.masterKeyOverride;
    }
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a random 12-byte IV.
   * A per-provider derived key is produced via HKDF using the provider salt.
   */
  async encrypt(plaintext: string, providerSalt?: string): Promise<EncryptedPayload> {
    const masterKey = await this.getMasterKey();
    const encKey = this.deriveKey(masterKey, providerSalt ?? "default");

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, encKey, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      version: KEY_VERSION,
    };
  }

  /**
   * Decrypts an EncryptedPayload. Throws if authentication fails.
   */
  async decrypt(payload: EncryptedPayload, providerSalt?: string): Promise<string> {
    const validatedPayload = validateEncryptedPayload(payload);
    if (validatedPayload.version !== KEY_VERSION) {
      throw new Error(`Unsupported key version: ${validatedPayload.version}`);
    }

    const masterKey = await this.getMasterKey();
    const encKey = this.deriveKey(masterKey, providerSalt ?? "default");

    const iv = Buffer.from(validatedPayload.iv, "hex");
    const ciphertext = Buffer.from(validatedPayload.ciphertext, "hex");
    const authTag = Buffer.from(validatedPayload.authTag, "hex");

    const decipher = createDecipheriv(ALGORITHM, encKey, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  /**
   * Retrieves the master key from the OS keychain (macOS) or falls back to
   * a file at ~/.helios/master.key (0600 permissions).
   * The key is cached in memory for the lifetime of this instance.
   */
  async getMasterKey(): Promise<Buffer> {
    if (this.masterKeyOverride !== null) {
      return Buffer.from(validateMasterKey(await this.masterKeyOverride(), "injected master key"));
    }

    if (this.masterKeyCache !== null) {
      return Buffer.from(this.masterKeyCache);
    }

    // Try macOS keychain first
    const fromKeychain = this.readFromKeychain();
    if (fromKeychain !== null) {
      this.masterKeyCache = fromKeychain;
      return Buffer.from(this.masterKeyCache);
    }

    // Fallback: file-based key
    const keyPath = this.keyPath;
    if (existsSync(keyPath)) {
      const hex = readFileSync(keyPath, "utf8").trim();
      this.masterKeyCache = parseMasterKeyHex(hex, "persisted master key");
      return Buffer.from(this.masterKeyCache);
    }

    // Generate a new key and persist it
    const newKey = randomBytes(KEY_BYTES);

    // Try to store in keychain
    const stored = this.writeToKeychain(newKey);
    if (!stored) {
      // Fall back to file
      const dir = dirname(keyPath);
      mkdirSync(dir, { recursive: true });
      const tempPath = `${keyPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
      try {
        writeFileSync(tempPath, newKey.toString("hex"), {
          encoding: "utf8",
          mode: 0o600,
        });
        renameSync(tempPath, keyPath);
        chmodSync(keyPath, 0o600);
      } finally {
        rmSync(tempPath, { force: true });
      }
    }

    this.masterKeyCache = newKey;
    return Buffer.from(this.masterKeyCache);
  }

  /**
   * Derives a 32-byte per-provider key from the master key using proper HKDF
   * (RFC 5869) via Node's native hkdfSync. The info field encodes the provider
   * ID to ensure domain separation between providers.
   */
  deriveKey(masterKey: Buffer, providerId: string): Buffer {
    validateMasterKey(masterKey, "master key");
    const info = Buffer.from(`helios-v1:${providerId}`, "utf8");
    const derived = hkdfSync("sha256", masterKey, Buffer.alloc(32), info, 32);
    return Buffer.from(derived);
  }

  /** Clears the cached master key from memory. */
  clearCache(): void {
    if (this.masterKeyCache !== null) {
      this.masterKeyCache.fill(0);
      this.masterKeyCache = null;
    }
  }

  private readFromKeychain(): Buffer | null {
    if (process.platform !== "darwin") return null;
    let hex: string;
    try {
      hex = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
        { stdio: ["pipe", "pipe", "pipe"] }
      )
        .toString()
        .trim();
    } catch {
      return null;
    }
    return parseMasterKeyHex(hex, "keychain master key");
  }

  private writeToKeychain(key: Buffer): boolean {
    if (process.platform !== "darwin") return false;
    try {
      execFileSync(
        "security",
        [
          "add-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT,
          "-w",
          key.toString("hex"),
          "-U",
        ],
        { stdio: ["pipe", "pipe", "pipe"] }
      );
      return true;
    } catch {
      return false;
    }
  }
}
