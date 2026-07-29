import { describe, expect, it } from "bun:test";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { RedactionAuditTrail } from "../audit-trail.js";
import { RedactionEngine } from "../redaction-engine.js";
import { getDefaultRules } from "../redaction-rules.js";

function makeEngine(): RedactionEngine {
  const engine = new RedactionEngine();
  engine.loadRules(getDefaultRules());
  return engine;
}

const ctx = {
  artifactId: "art-1",
  artifactType: "log",
  correlationId: "corr-1",
};

describe("RedactionAuditTrail: record creation", () => {
  it("creates a record and verify returns true", async () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    await trail.record("art-1", result, ctx);
    expect(trail.verify("art-1")).toBe(true);
  });

  it("verify returns false for unknown artifactId", () => {
    const trail = new RedactionAuditTrail();
    expect(trail.verify("nonexistent")).toBe(false);
  });

  it("record contains expected fields", async () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    const record = await trail.record("art-1", result, ctx);
    expect(record.artifactId).toBe("art-1");
    expect(record.artifactType).toBe("log");
    expect(record.correlationId).toBe("corr-1");
    expect(record.rulesApplied.length).toBeGreaterThan(0);
    expect(record.matchesByCategory["AWS_ACCESS_KEY"]).toBeGreaterThan(0);
    expect(record.timestamp).toBeTruthy();
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not expose mutable references to verification records", async () => {
    const trail = new RedactionAuditTrail();
    const result = makeEngine().redact("AKIAIOSFODNN7EXAMPLE", ctx);
    const recorded = await trail.record("art-1", result, ctx);

    recorded.artifactType = "mutated-record-result";
    const listed = trail.listRecords();
    expect(listed[0]?.artifactType).toBe("log");

    if (!listed[0]) throw new Error("Expected a verification record");
    listed[0].artifactType = "mutated-list-result";
    expect(trail.listRecords()[0]?.artifactType).toBe("log");
  });
});

describe("RedactionAuditTrail: no secrets in records", () => {
  it("record does not contain the matched secret value", async () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = engine.redact(secret, ctx);
    const record = await trail.record("art-1", result, ctx);
    // Stringify the record and ensure the secret doesn't appear
    const recordStr = JSON.stringify(record);
    expect(recordStr).not.toContain(secret);
  });
});

describe("RedactionAuditTrail: listRecords filtering", () => {
  it("filters by artifactType", async () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();

    const r1 = engine.redact("text1", {
      artifactId: "a1",
      artifactType: "log",
      correlationId: "c1",
    });
    const r2 = engine.redact("text2", {
      artifactId: "a2",
      artifactType: "artifact",
      correlationId: "c2",
    });
    await trail.record("a1", r1, {
      artifactId: "a1",
      artifactType: "log",
      correlationId: "c1",
    });
    await trail.record("a2", r2, {
      artifactId: "a2",
      artifactType: "artifact",
      correlationId: "c2",
    });

    const logs = trail.listRecords({ artifactType: "log" });
    expect(logs.length).toBe(1);
    expect(logs[0].artifactId).toBe("a1");
  });

  it("filters by since date", async () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();

    const before = new Date();
    await new Promise(r => setTimeout(r, 5));

    const r = engine.redact("text", ctx);
    await trail.record("art-1", r, ctx);

    const afterTime = new Date(before.getTime() - 1);
    const results = trail.listRecords({ since: afterTime });
    expect(results.length).toBe(1);

    const futureTime = new Date(Date.now() + 100000);
    const noResults = trail.listRecords({ since: futureTime });
    expect(noResults.length).toBe(0);
  });
});

describe("RedactionAuditTrail: bus events", () => {
  it("owns audit publication before recording verification state", async () => {
    const bus = new InMemoryLocalBus();
    let releasePublish: (() => void) | undefined;
    bus.publish = () =>
      new Promise<void>(resolve => {
        releasePublish = resolve;
      });
    const trail = new RedactionAuditTrail({ bus });
    const result = makeEngine().redact("AKIAIOSFODNN7EXAMPLE", ctx);

    const operation = trail.record("pending-artifact", result, ctx);
    const recordedBeforeAudit = trail.verify("pending-artifact");
    releasePublish?.();

    expect(operation).toBeInstanceOf(Promise);
    expect(recordedBeforeAudit).toBe(false);
    await operation;
    expect(trail.verify("pending-artifact")).toBe(true);
  });

  it("emits secrets.redaction.applied on record", async () => {
    const bus = new InMemoryLocalBus();
    const trail = new RedactionAuditTrail({ bus });
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    await trail.record("art-1", result, ctx);
    const events = bus.getEvents();
    expect(events.some(e => e.topic === "secrets.redaction.applied")).toBe(true);
  });

  it("emitted event does not contain the secret value", async () => {
    const bus = new InMemoryLocalBus();
    const trail = new RedactionAuditTrail({ bus });
    const engine = makeEngine();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = engine.redact(secret, ctx);
    await trail.record("art-1", result, ctx);
    const events = bus.getEvents();
    const eventsStr = JSON.stringify(events);
    expect(eventsStr).not.toContain(secret);
  });

  it("preserves verification state when audit publication fails", async () => {
    const bus = new InMemoryLocalBus();
    bus.publish = () => Promise.reject(new Error("audit unavailable"));
    const trail = new RedactionAuditTrail({ bus });
    const result = makeEngine().redact("AKIAIOSFODNN7EXAMPLE", ctx);

    await expect(trail.record("failed-artifact", result, ctx)).rejects.toThrow("audit unavailable");
    expect(trail.verify("failed-artifact")).toBe(false);
  });
});
