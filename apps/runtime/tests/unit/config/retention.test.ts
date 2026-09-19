import { describe, expect, it } from "bun:test";
import {
	createRetentionPolicyConfig,
	defaultRedactedFields,
} from "../../../src/config/retention";

describe("createRetentionPolicyConfig", () => {
	it("applies defaults for all fields", () => {
		const cfg = createRetentionPolicyConfig();
		expect(cfg.retention_days).toBe(30);
		expect(cfg.exempt_topics).toEqual(["audit.retention.deleted"]);
		expect(cfg.redacted_fields).toEqual(defaultRedactedFields());
	});

	it("preserves provided values", () => {
		const cfg = createRetentionPolicyConfig({
			retention_days: 90,
			exempt_topics: ["a.b"],
			redacted_fields: ["x"],
		});
		expect(cfg.retention_days).toBe(90);
		expect(cfg.exempt_topics).toEqual(["a.b"]);
		expect(cfg.redacted_fields).toEqual(["x"]);
	});

	it("copies provided arrays rather than aliasing input", () => {
		const topics = ["a.b"];
		const fields = ["k"];
		const cfg = createRetentionPolicyConfig({
			retention_days: 60,
			exempt_topics: topics,
			redacted_fields: fields,
		});
		topics.push("c.d");
		fields.push("k2");
		expect(cfg.exempt_topics).toEqual(["a.b"]);
		expect(cfg.redacted_fields).toEqual(["k"]);
	});

	it("throws on non-integer retention_days", () => {
		expect(() => createRetentionPolicyConfig({ retention_days: 30.5 })).toThrow(
			/integer/,
		);
	});

	it("throws below the 30-day floor", () => {
		for (const days of [0, 1, 29, -5]) {
			expect(() =>
				createRetentionPolicyConfig({ retention_days: days }),
			).toThrow(/>= 30/);
		}
	});
});

describe("defaultRedactedFields", () => {
	it("returns a fresh array each call", () => {
		const a = defaultRedactedFields();
		const b = defaultRedactedFields();
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});

	it("covers the credential-bearing field names", () => {
		const fields = defaultRedactedFields();
		for (const name of [
			"authorization",
			"token",
			"api_key",
			"secret",
			"password",
			"access_token",
			"refresh_token",
		]) {
			expect(fields).toContain(name);
		}
	});
});
