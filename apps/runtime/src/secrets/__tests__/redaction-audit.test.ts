
import { RedactionAuditTrail } from "../audit-trail.js";
import { RedactionEngine } from "../redaction-engine.js";
import { getDefaultRules } from "../redaction-rules.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";

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
  it("creates a record and verify returns true", () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    trail.record("art-1", result, ctx);
    expect(trail.verify("art-1")).toBe(true);
  });

  it("verify returns false for unknown artifactId", () => {
    const trail = new RedactionAuditTrail();
    expect(trail.verify("nonexistent")).toBe(false);
  });

  it("record contains expected fields", () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    const record = trail.record("art-1", result, ctx);
    expect(record.artifactId).toBe("art-1");
    expect(record.artifactType).toBe("log");
    expect(record.correlationId).toBe("corr-1");
    expect(record.rulesApplied.length).toBeGreaterThan(0);
    expect(record.matchesByCategory["AWS_ACCESS_KEY"]).toBeGreaterThan(0);
    expect(record.timestamp).toBeTruthy();
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("RedactionAuditTrail: no secrets in records", () => {
  it("record does not contain the matched secret value", () => {
    const trail = new RedactionAuditTrail();
    const engine = makeEngine();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = engine.redact(secret, ctx);
    const record = trail.record("art-1", result, ctx);
    // Stringify the record and ensure the secret doesn't appear
    const recordStr = JSON.stringify(record);
    expect(recordStr).not.toContain(secret);
  });
});

describe("RedactionAuditTrail: listRecords filtering", () => {
  it("filters by artifactType", () => {
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
    trail.record("a1", r1, {
      artifactId: "a1",
      artifactType: "log",
      correlationId: "c1",
    });
    trail.record("a2", r2, {
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
    trail.record("art-1", r, ctx);

    const afterTime = new Date(before.getTime() - 1);
    const results = trail.listRecords({ since: afterTime });
    expect(results.length).toBe(1);

    const futureTime = new Date(Date.now() + 100000);
    const noResults = trail.listRecords({ since: futureTime });
    expect(noResults.length).toBe(0);
  });
});

describe("RedactionAuditTrail: bus events", () => {
  it("emits secrets.redaction.applied on record", async () => {
    const bus = new InMemoryLocalBus();
    const trail = new RedactionAuditTrail({ bus });
    const engine = makeEngine();
    const result = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    trail.record("art-1", result, ctx);
    await new Promise(r => setTimeout(r, 10));
    const events = bus.getEvents();
    expect(events.some(e => e.topic === "secrets.redaction.applied")).toBe(true);
  });

  it("emitted event does not contain the secret value", async () => {
    const bus = new InMemoryLocalBus();
    const trail = new RedactionAuditTrail({ bus });
    const engine = makeEngine();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const result = engine.redact(secret, ctx);
    trail.record("art-1", result, ctx);
    await new Promise(r => setTimeout(r, 10));
    const events = bus.getEvents();
    const eventsStr = JSON.stringify(events);
    expect(eventsStr).not.toContain(secret);
  });
});
