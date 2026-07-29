import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { RedactionEngine } from "../redaction-engine.js";
import { getDefaultRules, RedactionRuleManager } from "../redaction-rules.js";

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
  it("adds a custom rule and it takes effect", async () => {
    const manager = new RedactionRuleManager({ initialRules: [] });
    await manager.addRule({
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

  it("rejects empty rule id", async () => {
    const manager = new RedactionRuleManager({ initialRules: [] });
    await expect(
      manager.addRule({
        id: "",
        category: "BAD",
        pattern: /test/,
        description: "bad",
        enabled: true,
      })
    ).rejects.toThrow();
  });

  it("rejects rules that can match empty input", async () => {
    const manager = new RedactionRuleManager({ initialRules: [] });

    await expect(
      manager.addRule({
        id: "zero-width",
        category: "BAD",
        pattern: /a*/,
        description: "would not advance the scanner",
        enabled: true,
      })
    ).rejects.toThrow("must consume input");
  });
});

describe("RedactionRuleManager: enable/disable", () => {
  it("disabled rule does not match", async () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    await manager.disableRule("aws-access-key");
    const engine = makeEngine(manager);
    const r = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    expect(r.matches.filter(m => m.category === "AWS_ACCESS_KEY").length).toBe(0);
  });

  it("re-enabled rule matches again", async () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    await manager.disableRule("aws-access-key");
    await manager.enableRule("aws-access-key");
    const engine = makeEngine(manager);
    const r = engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    expect(r.matches.filter(m => m.category === "AWS_ACCESS_KEY").length).toBeGreaterThan(0);
  });

  it("removeRule removes the rule", async () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    await manager.removeRule("aws-access-key");
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

  it("exports and imports rules", async () => {
    const manager = new RedactionRuleManager({
      initialRules: getDefaultRules(),
    });
    const path = join(tmpDir, "rules.json");
    manager.exportRules(path);

    const manager2 = new RedactionRuleManager({ initialRules: [] });
    await manager2.importRules(path);
    expect(manager2.listRules().length).toBe(manager.listRules().length);
  });

  it("rejects coerced persisted values", async () => {
    const path = join(tmpDir, "rules.json");
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: "coerced-enabled",
          category: "CUSTOM",
          pattern: "secret",
          description: "custom secret",
          enabled: "false",
        },
      ])
    );

    const manager = new RedactionRuleManager({ initialRules: [] });
    await expect(manager.importRules(path)).rejects.toThrow("enabled");
    expect(manager.listRules()).toEqual([]);
  });

  it("does not partially install rules when a later entry is malformed", async () => {
    const path = join(tmpDir, "rules.json");
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: "valid-rule",
          category: "CUSTOM",
          pattern: "valid-secret",
          description: "valid rule",
          enabled: true,
        },
        {
          id: "invalid-flags",
          category: "CUSTOM",
          pattern: "invalid-secret",
          flags: "not-a-flag",
          description: "invalid rule",
          enabled: true,
        },
      ])
    );

    const manager = new RedactionRuleManager({ initialRules: [] });
    await expect(manager.importRules(path)).rejects.toThrow();
    expect(manager.listRules()).toEqual([]);
  });

  it("atomically exports to a nested directory without temporary residue", () => {
    const manager = new RedactionRuleManager({ initialRules: getDefaultRules() });
    const directory = join(tmpDir, "nested");
    const path = join(directory, "rules.json");

    manager.exportRules(path);

    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(getDefaultRules().length);
    expect(readdirSync(directory).filter(entry => entry.startsWith("rules.json.tmp-"))).toEqual([]);
  });
});

describe("RedactionRuleManager: bus events", () => {
  it("owns audit publication before committing a rule change", async () => {
    const bus = new InMemoryLocalBus();
    let releasePublish: (() => void) | undefined;
    bus.publish = () =>
      new Promise<void>(resolve => {
        releasePublish = resolve;
      });
    const manager = new RedactionRuleManager({ bus, initialRules: [] });

    const operation = manager.addRule({
      id: "pending-audit",
      category: "TEST",
      pattern: /PENDING_SECRET/,
      description: "test",
      enabled: true,
    });
    const committedBeforeAudit = manager.listRules().length;
    releasePublish?.();

    expect(operation).toBeInstanceOf(Promise);
    expect(committedBeforeAudit).toBe(0);
    await operation;
    expect(manager.listRules()).toHaveLength(1);
  });

  it("emits event on rule change", async () => {
    const bus = new InMemoryLocalBus();
    const manager = new RedactionRuleManager({ bus, initialRules: [] });
    await manager.addRule({
      id: "test-rule",
      category: "TEST",
      pattern: /TEST_SECRET/,
      description: "test",
      enabled: true,
    });
    const events = bus.getEvents();
    expect(events.some(e => e.topic === "secrets.redaction.rules.changed")).toBe(true);
  });

  it("preserves rule state when audit publication fails", async () => {
    const bus = new InMemoryLocalBus();
    bus.publish = () => Promise.reject(new Error("audit unavailable"));
    const manager = new RedactionRuleManager({ bus, initialRules: [] });

    await expect(
      manager.addRule({
        id: "failed-audit",
        category: "TEST",
        pattern: /FAILED_SECRET/,
        description: "test",
        enabled: true,
      })
    ).rejects.toThrow("audit unavailable");
    expect(manager.listRules()).toEqual([]);
  });
});
