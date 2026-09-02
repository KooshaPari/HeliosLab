import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import {
  CredentialAlreadyExistsError,
  CredentialNotFoundError,
  CredentialStore,
} from "../credential-store.js";
import { EncryptionService } from "../encryption.js";

function makeStore(dataDir: string, bus: InMemoryLocalBus): CredentialStore {
  const fixedKey = randomBytes(32);
  const encryption = new EncryptionService({
    masterKeyOverride: async () => fixedKey,
  });
  return new CredentialStore({ dataDir, bus, encryption });
}

describe("CredentialStore: lifecycle operations", () => {
  let tmpDir: string;
  let bus: InMemoryLocalBus;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-lifecycle-test-"));
    bus = new InMemoryLocalBus();
    store = makeStore(tmpDir, bus);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  it("create emits secrets.credential.created event", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    const events = bus.getEvents();
    const created = events.find(e => e.topic === "secrets.credential.created");
    expect(created).toBeDefined();
    expect(created?.payload?.name).toBe("myKey");
    expect(created?.payload?.correlationId).toBe("corr-001");
  });

  it("create event does NOT include credential value", async () => {
    await store.create("providerA", "ws1", "myKey", "top-secret", "corr-001");
    const events = bus.getEvents();
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("top-secret");
  });

  it("rolls back the credential when create audit publication fails", async () => {
    bus.publish = () => Promise.reject(new Error("audit unavailable"));

    await expect(
      store.create("providerA", "ws1", "myKey", "secret", "corr-create")
    ).rejects.toThrow("audit unavailable");
    await expect(store.retrieve("providerA", "ws1", "myKey")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("does not delete a concurrent rotation when create audit publication fails", async () => {
    const publish = bus.publish.bind(bus);
    bus.publish = async envelope => {
      if (envelope.topic === "secrets.credential.created") {
        await store.rotate("providerA", "ws1", "myKey", "rotated", "corr-rotate");
        throw new Error("audit unavailable");
      }
      await publish(envelope);
    };

    let failure: unknown;
    try {
      await store.create("providerA", "ws1", "myKey", "created", "corr-create");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toEqual(new Error("audit unavailable"));
    expect((failure as AggregateError).errors[1]).toEqual(
      new Error("Credential changed before create audit rollback")
    );
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("rotated");
  });

  it("create rejects duplicate credential", async () => {
    await store.create("providerA", "ws1", "myKey", "v1", "corr-001");
    await expect(
      store.create("providerA", "ws1", "myKey", "v2", "corr-002")
    ).rejects.toBeInstanceOf(CredentialAlreadyExistsError);
  });

  it("allows exactly one winner for concurrent creates", async () => {
    const attempts = await Promise.allSettled([
      store.create("providerA", "ws1", "racedKey", "first", "corr-001"),
      store.create("providerA", "ws1", "racedKey", "second", "corr-002"),
    ]);

    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.filter(result => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CredentialAlreadyExistsError
    );
    expect(["first", "second"]).toContain(await store.retrieve("providerA", "ws1", "racedKey"));
  });

  it("create allows same name in different provider", async () => {
    await store.create("providerA", "ws1", "myKey", "v1", "corr-001");
    await store.create("providerB", "ws1", "myKey", "v2", "corr-002");
    // Both should succeed
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("v1");
    expect(await store.retrieve("providerB", "ws1", "myKey")).toBe("v2");
  });

  // -------------------------------------------------------------------------
  // rotate
  // -------------------------------------------------------------------------
  it("rotate updates the credential value", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-001");
    await store.rotate("providerA", "ws1", "myKey", "rotated", "corr-002");
    const result = await store.retrieve("providerA", "ws1", "myKey");
    expect(result).toBe("rotated");
  });

  it("rotate emits secrets.credential.rotated event", async () => {
    await store.create("providerA", "ws1", "myKey", "v1", "corr-001");
    await store.rotate("providerA", "ws1", "myKey", "v2", "corr-002");
    const events = bus.getEvents();
    const rotated = events.find(e => e.topic === "secrets.credential.rotated");
    expect(rotated).toBeDefined();
    expect(rotated?.payload?.name).toBe("myKey");
    expect(rotated?.payload?.correlationId).toBe("corr-002");
  });

  it("rotate event does NOT include credential value", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-001");
    await store.rotate("providerA", "ws1", "myKey", "rotated-secret", "corr-002");
    const events = bus.getEvents();
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("rotated-secret");
    expect(raw).not.toContain("original");
  });

  it("preserves the credential when rotate audit publication fails", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    bus.publish = () => Promise.reject(new Error("audit unavailable"));

    await expect(
      store.rotate("providerA", "ws1", "myKey", "replacement", "corr-rotate")
    ).rejects.toThrow("audit unavailable");
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("original");
  });

  it("publishes rotate audit before replacing the credential", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    let releasePublish: (() => void) | undefined;
    bus.publish = () =>
      new Promise<void>(resolve => {
        releasePublish = resolve;
      });

    const operation = store.rotate("providerA", "ws1", "myKey", "replacement", "corr-rotate");
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("original");
    releasePublish?.();
    await operation;
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("replacement");
  });

  it("does not recreate a concurrent revocation after rotate audit publication", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    const publish = bus.publish.bind(bus);
    bus.publish = async envelope => {
      if (envelope.topic === "secrets.credential.rotated") {
        await store.revoke("providerA", "ws1", "myKey", "corr-revoke");
      }
      await publish(envelope);
    };

    await expect(
      store.rotate("providerA", "ws1", "myKey", "replacement", "corr-rotate")
    ).rejects.toThrow("Credential changed before rotate");
    await expect(store.retrieve("providerA", "ws1", "myKey")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("rotate throws on non-existent credential", async () => {
    await expect(
      store.rotate("providerA", "ws1", "noSuchKey", "new", "corr-001")
    ).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------
  it("revoke removes the credential", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    await store.revoke("providerA", "ws1", "myKey", "corr-002");
    await expect(store.retrieve("providerA", "ws1", "myKey")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("revoke emits secrets.credential.revoked event", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    await store.revoke("providerA", "ws1", "myKey", "corr-002");
    const events = bus.getEvents();
    const revoked = events.find(e => e.topic === "secrets.credential.revoked");
    expect(revoked).toBeDefined();
    expect(revoked?.payload?.name).toBe("myKey");
    expect(revoked?.payload?.correlationId).toBe("corr-002");
  });

  it("revoke event does NOT include credential value", async () => {
    await store.create("providerA", "ws1", "myKey", "my-secret-data", "corr-001");
    await store.revoke("providerA", "ws1", "myKey", "corr-002");
    const events = bus.getEvents();
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("my-secret-data");
  });

  it("preserves the credential when revoke audit publication fails", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    bus.publish = () => Promise.reject(new Error("audit unavailable"));

    await expect(store.revoke("providerA", "ws1", "myKey", "corr-revoke")).rejects.toThrow(
      "audit unavailable"
    );
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("original");
  });

  it("publishes revoke audit before deleting the credential", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    let releasePublish: (() => void) | undefined;
    bus.publish = () =>
      new Promise<void>(resolve => {
        releasePublish = resolve;
      });

    const operation = store.revoke("providerA", "ws1", "myKey", "corr-revoke");
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("original");
    releasePublish?.();
    await operation;
    await expect(store.retrieve("providerA", "ws1", "myKey")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  it("does not delete a concurrent rotation after revoke audit publication", async () => {
    await store.create("providerA", "ws1", "myKey", "original", "corr-create");
    const publish = bus.publish.bind(bus);
    bus.publish = async envelope => {
      if (envelope.topic === "secrets.credential.revoked") {
        await store.rotate("providerA", "ws1", "myKey", "rotated", "corr-rotate");
      }
      await publish(envelope);
    };

    await expect(store.revoke("providerA", "ws1", "myKey", "corr-revoke")).rejects.toThrow(
      "Credential changed before revoke"
    );
    expect(await store.retrieve("providerA", "ws1", "myKey")).toBe("rotated");
  });

  it("revoke throws on non-existent credential", async () => {
    await expect(store.revoke("providerA", "ws1", "noSuchKey", "corr-001")).rejects.toBeInstanceOf(
      CredentialNotFoundError
    );
  });

  // -------------------------------------------------------------------------
  // retrieve emits accessed event
  // -------------------------------------------------------------------------
  it("retrieveWithContext emits secrets.credential.accessed", async () => {
    await store.create("providerA", "ws1", "myKey", "secret", "corr-001");
    await store.retrieveWithContext(
      {
        requestingProviderId: "providerA",
        requestingWorkspaceId: "ws1",
        correlationId: "corr-002",
      },
      "providerA",
      "ws1",
      "myKey"
    );
    const events = bus.getEvents();
    const accessed = events.find(e => e.topic === "secrets.credential.accessed");
    expect(accessed).toBeDefined();
    expect(accessed?.payload?.name).toBe("myKey");
  });

  it("accessed event does NOT include credential value", async () => {
    await store.create("providerA", "ws1", "myKey", "ultra-secret", "corr-001");
    await store.retrieveWithContext(
      {
        requestingProviderId: "providerA",
        requestingWorkspaceId: "ws1",
        correlationId: "corr-002",
      },
      "providerA",
      "ws1",
      "myKey"
    );
    const events = bus.getEvents();
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("ultra-secret");
  });
});
