import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RedactionEngine } from "../redaction-engine.js";
import { getDefaultRules, RedactionRuleManager } from "../redaction-rules.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";

const ctx = {
  artifactId: "art-1",
  artifactType: "log",
  correlationId: "corr-1",
};

function makeEngine(manager?: RedactionRuleManager): RedactionEngine {
  const engine = new RedactionEngine();
  engine.loadRules(manager ? manager.listRules() : getDefaultRules());
  return engine;
}

describe("Default rules: positive examples", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("AWS Access Key - positive", () => {
    const r = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].category).toBe("AWS_ACCESS_KEY");
  });

  it("GCP API Key - positive", () => {
    const r = engine.redact("AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe", ctx);
    expect(r.matches.some(m => m.category === "GCP_API_KEY")).toBe(true);
  });

  it("GitHub token ghp_ - positive", () => {
    const r = engine.redact("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456", ctx);
    expect(r.matches.some(m => m.category === "GITHUB_TOKEN")).toBe(true);
  });

  it("GitHub token ghs_ - positive", () => {
    const r = engine.redact("ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456", ctx);
    expect(r.matches.some(m => m.category === "GITHUB_TOKEN")).toBe(true);
  });

  it("OpenAI key - positive", () => {
    const r = engine.redact("sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890123456789012", ctx);
    expect(r.matches.some(m => m.category === "OPENAI_KEY")).toBe(true);
  });

  it("Bearer token - positive", () => {
    const r = engine.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9", ctx);
    expect(r.matches.some(m => m.category === "BEARER_TOKEN")).toBe(true);
  });

  it("Connection string postgres - positive", () => {
    const r = engine.redact("postgres://user:secret@localhost/db", ctx);
    expect(r.matches.some(m => m.category === "CONNECTION_STRING")).toBe(true);
  });

  it("Connection string mongodb - positive", () => {
    const r = engine.redact("mongodb://admin:pass@mongo.example.com/db", ctx);
    expect(r.matches.some(m => m.category === "CONNECTION_STRING")).toBe(true);
  });

  it("Private key - positive", () => {
    const r = engine.redact("-----BEGIN RSA PRIVATE KEY-----", ctx);
    expect(r.matches.some(m => m.category === "PRIVATE_KEY")).toBe(true);
  });

  it("Private key EC - positive", () => {
    const r = engine.redact("-----BEGIN EC PRIVATE KEY-----", ctx);
    expect(r.matches.some(m => m.category === "PRIVATE_KEY")).toBe(true);
  });
});

describe("Default rules: negative examples", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("AWS Access Key - negative (too short)", () => {
    const r = engine.redact("AKIA123SHORT", ctx);
    expect(r.matches.filter(m => m.category === "AWS_ACCESS_KEY").length).toBe(0);
  });

  it("OpenAI key - negative (too short)", () => {
    const r = engine.redact("sk-short", ctx);
    expect(r.matches.filter(m => m.category === "OPENAI_KEY").length).toBe(0);
  });

  it("GCP key - negative (wrong prefix)", () => {
    const r = engine.redact("AIzbSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe", ctx);
    expect(r.matches.filter(m => m.category === "GCP_API_KEY").length).toBe(0);
  });

  it("Private key - negative (wrong header)", () => {
    const r = engine.redact("-----BEGIN CERTIFICATE-----", ctx);
    expect(r.matches.filter(m => m.category === "PRIVATE_KEY").length).toBe(0);
  });
});

describe("RedactionRuleManager: custom rules", () => {
  it("adds a custom rule and it takes effect", () => {
    const manager = new RedactionRuleManager({ initialRules: [] });
    manager.addRule({
      id: "custom-secret",
      category: "CUSTOM",
      pattern: /MYSECRET[A-Z]{4}/,
      description: "Custom secret",
      enabled: true,
    });
    const engine = makeEngine(manager);
    const r = engine.redact("value: MYSECRETABCD end", ctx);
    expect(r.matches.some(m => m.category === "CUSTOM")).toBe(true);
  });

  it("rejects empty rule id", () => {
    const manager = new RedactionRuleManager({ initialRules: [] });
    expect(() =>
      manager.addRule({
        id: "",
        category: "BAD",
        pattern: /test/,
        description: "bad",
        enabled: true,
      })
    ).toThrow();
  });
});

describe("RedactionRuleManager: enable/disable", () => {
  it("disabled rule does not match", () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    manager.disableRule("aws-access-key");
    const engine = makeEngine(manager);
    const r = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    expect(r.matches.filter(m => m.category === "AWS_ACCESS_KEY").length).toBe(0);
  });

  it("re-enabled rule matches again", () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    manager.disableRule("aws-access-key");
    manager.enableRule("aws-access-key");
    const engine = makeEngine(manager);
    const r = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    expect(r.matches.filter(m => m.category === "AWS_ACCESS_KEY").length).toBeGreaterThan(0);
  });

  it("removeRule removes the rule", () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    manager.removeRule("aws-access-key");
    expect(manager.listRules().some(r => r.id === "aws-access-key")).toBe(false);
  });
});

describe("RedactionRuleManager: persistence", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "helios-rules-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports and imports rules", () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    const path = join(tmpDir, "rules.json");
    manager.exportRules(path);

    const manager2 = new RedactionRuleManager({ initialRules: [] });
    manager2.importRules(path);
    expect(manager2.listRules().length).toBe(manager.listRules().length);
  });
});

describe("RedactionRuleManager: bus events", () => {
  it("emits event on rule change", async () => {
    const bus = new InMemoryLocalBus();
    const manager = new RedactionRuleManager({ bus, initialRules: [] });
    manager.addRule({
      id: "test-rule",
      category: "TEST",
      pattern: /TEST_SECRET/,
      description: "test",
      enabled: true,
    });
    // give async emit a tick
    await new Promise(r => setTimeout(r, 10));
    const events = bus.getEvents();
    expect(events.some(e => e.topic === "secrets.redaction.rules.changed")).toBe(true);
  });
});
