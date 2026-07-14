import { describe, it, expect, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { EncryptionService } from "../encryption.js";

function makeFixedKeyService(): EncryptionService {
  const fixedKey = randomBytes(32);
  return new EncryptionService({
    masterKeyOverride: async () => fixedKey,
  });
}

// Traces to: FR-SEC-001 (encryption at rest)
describe("EncryptionService", () => {
  let svc: EncryptionService;

  beforeEach(() => {
    svc = makeFixedKeyService();
  });

  it("encrypts and decrypts round-trip", async () => {
    const plaintext = "my-super-secret-value";
    const payload = await svc.encrypt(plaintext, "provider-a");
    const result = await svc.decrypt(payload, "provider-a");
    expect(result).toBe(plaintext);
  });

  it("produces a different IV on each call", async () => {
    const p1 = await svc.encrypt("hello", "provider-a");
    const p2 = await svc.encrypt("hello", "provider-a");
    expect(p1.iv).not.toBe(p2.iv);
  });

  it("produces different ciphertext for same plaintext due to random IV", async () => {
    const p1 = await svc.encrypt("hello", "provider-a");
    const p2 = await svc.encrypt("hello", "provider-a");
    expect(p1.ciphertext).not.toBe(p2.ciphertext);
  });

  it("uses different derived keys for different providers", async () => {
    const masterKey = randomBytes(32);
    const k1 = svc.deriveKey(masterKey, "provider-a");
    const k2 = svc.deriveKey(masterKey, "provider-b");
    expect(k1.toString("hex")).not.toBe(k2.toString("hex"));
  });

  it("throws when authTag is tampered", async () => {
    const payload = await svc.encrypt("secret", "provider-a");
    // Flip one byte of the authTag
    const tampered = {
      ...payload,
      authTag: "00".repeat(16),
    };
    await expect(svc.decrypt(tampered, "provider-a")).rejects.toThrow();
  });

  it("throws when ciphertext is tampered", async () => {
    const payload = await svc.encrypt("secret", "provider-a");
    // Corrupt the ciphertext
    const bytes = Buffer.from(payload.ciphertext, "hex");
    bytes[0] ^= 0xff;
    const tampered = { ...payload, ciphertext: bytes.toString("hex") };
    await expect(svc.decrypt(tampered, "provider-a")).rejects.toThrow();
  });

  it("throws on unsupported version", async () => {
    const payload = await svc.encrypt("secret", "provider-a");
    const bad = { ...payload, version: 99 };
    await expect(svc.decrypt(bad, "provider-a")).rejects.toThrow("Unsupported key version");
  });

  it("fails to decrypt with wrong provider salt", async () => {
    const payload = await svc.encrypt("secret", "provider-a");
    // Wrong provider produces different key → GCM auth failure
    await expect(svc.decrypt(payload, "provider-b")).rejects.toThrow();
  });

  it("encrypts empty string", async () => {
    const payload = await svc.encrypt("", "provider-a");
    const result = await svc.decrypt(payload, "provider-a");
    expect(result).toBe("");
  });

  it("encrypts unicode content", async () => {
    const plaintext = "🔐 secret données 秘密";
    const payload = await svc.encrypt(plaintext, "provider-a");
    const result = await svc.decrypt(payload, "provider-a");
    expect(result).toBe(plaintext);
  });

  it("version field is always 1", async () => {
    const payload = await svc.encrypt("x", "provider-a");
    expect(payload.version).toBe(1);
  });

  it("IV is 12 bytes (24 hex chars)", async () => {
    const payload = await svc.encrypt("x", "provider-a");
    expect(payload.iv.length).toBe(24);
  });

  it("authTag is 16 bytes (32 hex chars)", async () => {
    const payload = await svc.encrypt("x", "provider-a");
    expect(payload.authTag.length).toBe(32);
  });
});
