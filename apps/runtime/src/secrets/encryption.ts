import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export class EncryptionService {
  private masterKeyCache: Buffer | null = null;
  // For testing: allow injection of a master key getter
  private masterKeyOverride: (() => Promise<Buffer>) | null = null;

  constructor(opts?: { masterKeyOverride?: () => Promise<Buffer> }) {
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
    if (payload.version !== KEY_VERSION) {
      throw new Error(`Unsupported key version: ${payload.version}`);
    }

    const masterKey = await this.getMasterKey();
    const encKey = this.deriveKey(masterKey, providerSalt ?? "default");

    const iv = Buffer.from(payload.iv, "hex");
    const ciphertext = Buffer.from(payload.ciphertext, "hex");
    const authTag = Buffer.from(payload.authTag, "hex");

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
      return this.masterKeyOverride();
    }

    if (this.masterKeyCache !== null) {
      return this.masterKeyCache;
    }

    // Try macOS keychain first
    const fromKeychain = this.readFromKeychain();
    if (fromKeychain !== null) {
      this.masterKeyCache = fromKeychain;
      return this.masterKeyCache;
    }

    // Fallback: file-based key
    const keyPath = join(homedir(), ".helios", "master.key");
    if (existsSync(keyPath)) {
      const hex = readFileSync(keyPath, "utf8").trim();
      this.masterKeyCache = Buffer.from(hex, "hex");
      return this.masterKeyCache;
    }

    // Generate a new key and persist it
    const newKey = randomBytes(KEY_BYTES);

    // Try to store in keychain
    const stored = this.writeToKeychain(newKey);
    if (!stored) {
      // Fall back to file
      const dir = join(homedir(), ".helios");
      mkdirSync(dir, { recursive: true });
      writeFileSync(keyPath, newKey.toString("hex"), {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(keyPath, 0o600);
    }

    this.masterKeyCache = newKey;
    return this.masterKeyCache;
  }

  /**
   * Derives a 32-byte per-provider key from the master key using proper HKDF
   * (RFC 5869) via Node's native hkdfSync. The info field encodes the provider
   * ID to ensure domain separation between providers.
   */
  deriveKey(masterKey: Buffer, providerId: string): Buffer {
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
    try {
      const hex = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
        { stdio: ["pipe", "pipe", "pipe"] }
      )
        .toString()
        .trim();
      if (hex.length === KEY_BYTES * 2) {
        return Buffer.from(hex, "hex");
      }
      return null;
    } catch {
      return null;
    }
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
