import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptionService } from "../encryption.js";
import {
  CredentialStore,
  CredentialNotFoundError,
} from "../credential-store.js";

function makeStore(dataDir: string): CredentialStore {
  const fixedKey = randomBytes(32);
  const encryption = new EncryptionService({
    masterKeyOverride: async () => fixedKey,
  });
  return new CredentialStore({ dataDir, encryption });
}

// Traces to: FR-SEC-001 (secure credential store with encryption), FR-SEC-002 (provider+workspace scoping)
describe("CredentialStore: store and retrieve", () => {
  let tmpDir: string;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-cred-test-"));
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores and retrieves a credential", async () => {
    await store.store("providerA", "ws1", "myKey", "myValue");
    const result = await store.retrieve("providerA", "ws1", "myKey");
    expect(result).toBe("myValue");
  });

  it("stores file as encrypted (not plaintext on disk)", async () => {
    await store.store("providerA", "ws1", "myKey", "super-secret");
    const filePath = join(tmpDir, "secrets", "providerA", "ws1", "myKey.enc");
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf8");
    expect(raw).not.toContain("super-secret");
    // Should be valid JSON with ciphertext field
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty("ciphertext");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("authTag");
  });

  it("stores file with 0600 permissions on unix", async () => {
    if (process.platform === "win32") return;
    await store.store("providerA", "ws1", "myKey", "secret");
    const filePath = join(tmpDir, "secrets", "providerA", "ws1", "myKey.enc");
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("lists credential names", async () => {
    await store.store("providerA", "ws1", "key1", "v1");
    await store.store("providerA", "ws1", "key2", "v2");
    const names = store.list("providerA", "ws1");
    expect(names.sort()).toEqual(["key1", "key2"]);
  });

  it("returns empty list when no credentials", () => {
    const names = store.list("providerA", "ws-nonexistent");
    expect(names).toEqual([]);
  });

  it("throws CredentialNotFoundError on missing retrieve", async () => {
    await expect(store.retrieve("providerA", "ws1", "missing")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("deletes a credential", async () => {
    await store.store("providerA", "ws1", "myKey", "secret");
    await store.delete("providerA", "ws1", "myKey");
    const names = store.list("providerA", "ws1");
    expect(names).not.toContain("myKey");
  });

  it("throws CredentialNotFoundError when deleting missing credential", async () => {
    await expect(store.delete("providerA", "ws1", "missing")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("overwrites value on repeated store", async () => {
    await store.store("providerA", "ws1", "key", "original");
    await store.store("providerA", "ws1", "key", "updated");
    const result = await store.retrieve("providerA", "ws1", "key");
    expect(result).toBe("updated");
  });

  it("scopes credentials by provider", async () => {
    await store.store("providerA", "ws1", "key", "valueA");
    await store.store("providerB", "ws1", "key", "valueB");
    expect(await store.retrieve("providerA", "ws1", "key")).toBe("valueA");
    expect(await store.retrieve("providerB", "ws1", "key")).toBe("valueB");
  });

  it("scopes credentials by workspace", async () => {
    await store.store("providerA", "ws1", "key", "value1");
    await store.store("providerA", "ws2", "key", "value2");
    expect(await store.retrieve("providerA", "ws1", "key")).toBe("value1");
    expect(await store.retrieve("providerA", "ws2", "key")).toBe("value2");
  });

  it("rejects path traversal in providerId", async () => {
    await expect(store.store("../evil", "ws1", "key", "val")).rejects.toThrow();
  });

  it("rejects path traversal in workspaceId", async () => {
    await expect(store.store("providerA", "../../etc", "key", "val")).rejects.toThrow();
  });

  it("rejects null bytes in name", async () => {
    await expect(store.store("providerA", "ws1", "key\0evil", "val")).rejects.toThrow();
  });

  it("rejects slash in name", async () => {
    await expect(store.store("providerA", "ws1", "key/evil", "val")).rejects.toThrow();
  });

  it("rejects backslash in name", async () => {
    await expect(store.store("providerA", "ws1", "key\\evil", "val")).rejects.toThrow();
  });
});

describe("CredentialStore: rotate preserves file permissions", () => {
  let tmpDir: string;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-cred-rotate-"));
    store = makeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("file permissions are 0600 after rotate (unix only)", async () => {
    if (process.platform === "win32") return;
    await store.store("providerA", "ws1", "rotKey", "original");
    await store.rotate("providerA", "ws1", "rotKey", "rotated", "corr-1");
    const filePath = join(tmpDir, "secrets", "providerA", "ws1", "rotKey.enc");
    expect(existsSync(filePath)).toBe(true);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
