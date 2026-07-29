import { beforeEach, describe, expect, it } from "bun:test";
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

// Traces to: FR-SEC-004 (pattern-based redaction engine)
describe("RedactionEngine: known patterns redacted", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("redacts AWS Access Key", () => {
    const result = engine.redact("Key is AKIAIOSFODNN7EXAMPLE here", ctx);
    expect(result.redacted).toContain("[REDACTED:");
    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("redacts GCP API Key", () => {
    const result = engine.redact("gcp key: AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe", ctx);
    expect(result.redacted).not.toContain("AIzaSy");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("redacts GitHub token", () => {
    const result = engine.redact("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456", ctx);
    expect(result.redacted).not.toContain("ghp_");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("redacts OpenAI key", () => {
    const result = engine.redact("key=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890123456789012", ctx);
    expect(result.redacted).not.toContain("sk-ABC");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("redacts Bearer token", () => {
    const result = engine.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ctx);
    expect(result.redacted).not.toContain("eyJhbGci");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("redacts connection string", () => {
    const result = engine.redact("postgres://user:password@localhost:5432/mydb", ctx);
    expect(result.redacted).toContain("[REDACTED:CONNECTION_STRING]");
    expect(result.redacted).not.toContain("password");
  });

  it("redacts private key header", () => {
    const result = engine.redact("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...", ctx);
    expect(result.redacted).toContain("[REDACTED:PRIVATE_KEY]");
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

describe("RedactionEngine: binary bypass", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("isTextContent returns true for strings", () => {
    expect(engine.isTextContent("hello")).toBe(true);
  });

  it("isTextContent returns false for Buffer", () => {
    expect(engine.isTextContent(Buffer.from("hello"))).toBe(false);
  });

  it("isTextContent returns false for null", () => {
    expect(engine.isTextContent(null)).toBe(false);
  });

  it("isTextContent returns false for numbers", () => {
    expect(engine.isTextContent(42)).toBe(false);
  });
});

describe("RedactionEngine: latency under 5ms", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("redacts a short string in under 5ms", () => {
    const result = engine.redact("hello world this is normal text", ctx);
    expect(result.latencyMs).toBeLessThan(5);
  });

  it("keeps p95 latency for a longer string under 5ms", () => {
    const longText = "normal text ".repeat(500);
    const latencies = Array.from(
      { length: 100 },
      () => engine.redact(longText, ctx).latencyMs
    ).sort((left, right) => left - right);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

    expect(p95).toBeLessThan(5);
  });
});

describe("RedactionEngine: multiple secrets", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("redacts multiple secrets in one pass", () => {
    const input = "aws: AKIAIOSFODNN7EXAMPLE and gcp: AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
    const result = engine.redact(input, ctx);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redacted).not.toContain("AIzaSy");
  });
});

describe("RedactionEngine: scanner progress", () => {
  it("ignores contextual zero-width matches without stalling", () => {
    const engine = new RedactionEngine();
    engine.loadRules([
      {
        id: "lookahead",
        category: "ZERO_WIDTH",
        pattern: /(?=secret)/,
        description: "zero-width only when context is present",
        enabled: true,
      },
    ]);

    const result = engine.redact("secret secret", ctx);

    expect(result.redacted).toBe("secret secret");
    expect(result.matches).toEqual([]);
  });
});

describe("RedactionEngine: no false positives on normal text", () => {
  let engine: RedactionEngine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it("does not redact normal log messages", () => {
    const text = "User logged in from IP 192.168.1.1 at 2024-01-01T00:00:00Z";
    const result = engine.redact(text, ctx);
    expect(result.matches.length).toBe(0);
    expect(result.redacted).toBe(text);
  });

  it("does not redact normal code snippets", () => {
    const text = "const x = 42; function hello() { return 'world'; }";
    const result = engine.redact(text, ctx);
    expect(result.matches.length).toBe(0);
  });
});

describe("RedactionEngine: stats tracking", () => {
  it("tracks total scans, matches, and avg latency", () => {
    const engine = makeEngine();
    engine.redact("AKIAIOSFODNN7EXAMPLE", ctx);
    engine.redact("normal text", ctx);
    const stats = engine.getStats();
    expect(stats.totalScans).toBe(2);
    expect(stats.totalMatches).toBeGreaterThanOrEqual(1);
    expect(stats.avgLatencyMs).toBeGreaterThan(0);
  });
});
