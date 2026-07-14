import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptionService } from "../encryption.js";
import { CredentialStore, CredentialAccessDeniedError } from "../credential-store.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";

function makeStore(dataDir: string, bus: InMemoryLocalBus): CredentialStore {
  const fixedKey = randomBytes(32);
  const encryption = new EncryptionService({
    masterKeyOverride: async () => fixedKey,
  });
  return new CredentialStore({ dataDir, bus, encryption });
}

describe("CredentialStore: cross-provider isolation", () => {
  let tmpDir: string;
  let bus: InMemoryLocalBus;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-isolation-test-"));
    bus = new InMemoryLocalBus();
    store = makeStore(tmpDir, bus);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows access when requestingProviderId matches targetProviderId", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    const value = await store.retrieveWithContext(
      {
        requestingProviderId: "providerA",
        requestingWorkspaceId: "ws1",
        correlationId: "corr-002",
      },
      "providerA",
      "ws1",
      "myKey"
    );
    expect(value).toBe("secret");
  });

  it("denies cross-provider access", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    await expect(
      store.retrieveWithContext(
        {
          requestingProviderId: "providerB",
          requestingWorkspaceId: "ws1",
          correlationId: "corr-002",
        },
        "providerA",
        "ws1",
        "myKey"
      )
    ).rejects.toBeInstanceOf(CredentialAccessDeniedError);
  });

  it("denied access emits secrets.credential.access.denied event", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    try {
      await store.retrieveWithContext(
        {
          requestingProviderId: "evil-provider",
          requestingWorkspaceId: "ws1",
          correlationId: "corr-002",
        },
        "providerA",
        "ws1",
        "myKey"
      );
    } catch {
      // expected
    }
    // Give the fire-and-forget a tick to settle
    await new Promise(r => setTimeout(r, 10));
    const events = bus.getEvents();
    const denied = events.find(e => e.topic === "secrets.credential.access.denied");
    expect(denied).toBeDefined();
    expect(denied?.payload?.requestingProviderId).toBe("evil-provider");
    expect(denied?.payload?.targetProviderId).toBe("providerA");
  });

  it("denied event does NOT include credential values", async () => {
    await store.create("providerA", "ws1", "myKey", "secret-value", "corr-001");
    try {
      await store.retrieveWithContext(
        {
          requestingProviderId: "evil",
          requestingWorkspaceId: "ws1",
          correlationId: "corr-002",
        },
        "providerA",
        "ws1",
        "myKey"
      );
    } catch {
      // expected
    }
    await new Promise(r => setTimeout(r, 10));
    const events = bus.getEvents();
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("secret-value");
  });

  it("denies cross-workspace access even with same provider", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    await expect(
      store.retrieveWithContext(
        {
          requestingProviderId: "providerA",
          requestingWorkspaceId: "ws2",
          correlationId: "corr-002",
        },
        "providerA",
        "ws1",
        "myKey"
      )
    ).rejects.toBeInstanceOf(CredentialAccessDeniedError);
  });

  // -------------------------------------------------------------------------
  // Path traversal rejection
  // -------------------------------------------------------------------------
  it("rejects .. in requestingProviderId", async () => {
    await expect(
      store.retrieveWithContext(
        {
          requestingProviderId: "../evil",
          requestingWorkspaceId: "ws1",
          correlationId: "c",
        },
        "providerA",
        "ws1",
        "myKey"
      )
    ).rejects.toThrow();
  });

  it("rejects / in requestingWorkspaceId", async () => {
    await expect(
      store.retrieveWithContext(
        {
          requestingProviderId: "p",
          requestingWorkspaceId: "/etc/passwd",
          correlationId: "c",
        },
        "providerA",
        "ws1",
        "myKey"
      )
    ).rejects.toThrow();
  });

  it("rejects null byte in targetProviderId during store", async () => {
    await expect(store.store("provider\0A", "ws1", "key", "val")).rejects.toThrow();
  });

  it("rejects backslash in workspaceId during store", async () => {
    await expect(store.store("providerA", "ws\\evil", "key", "val")).rejects.toThrow();
  });

  it("CredentialAccessDeniedError has correct code", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    try {
      await store.retrieveWithContext(
        {
          requestingProviderId: "other",
          requestingWorkspaceId: "ws1",
          correlationId: "c",
        },
        "providerA",
        "ws1",
        "myKey"
      );
      expect(true).toBe(false); // should not reach here
    } catch {
      expect(err).toBeInstanceOf(CredentialAccessDeniedError);
      expect((err as CredentialAccessDeniedError).code).toBe("CREDENTIAL_ACCESS_DENIED");
    }
  });
});
