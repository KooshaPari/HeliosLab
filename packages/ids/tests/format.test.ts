// FR-008 — Format compliance test
// Verifies 100% of generated IDs conform to the format specification.
import { describe, test, expect } from "bun:test";
import { generateId } from "../src/index.js";
import type { EntityType } from "../src/index.js";

const FORMAT_REGEX = /^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/;
const EXCLUDED_CHARS = /[ILOU]/; // Crockford base32 excludes I, L, O, U
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/;
const IDS_PER_TYPE = 10_000;

const ENTITY_TYPES: EntityType[] = [
	"workspace",
	"lane",
	"session",
	"terminal",
	"run",
	"correlation",
];

describe("format compliance", () => {
	for (const entityType of ENTITY_TYPES) {
		test(`${entityType}: ${IDS_PER_TYPE} IDs match format regex`, () => {
			for (let i = 0; i < IDS_PER_TYPE; i++) {
				const id = generateId(entityType);
				expect(id).toMatch(FORMAT_REGEX);
			}
		});

		test(`${entityType}: IDs contain no excluded Crockford characters (I, L, O, U)`, () => {
			for (let i = 0; i < IDS_PER_TYPE; i++) {
				const id = generateId(entityType);
				const body = id.substring(id.indexOf("_") + 1);
				expect(body).not.toMatch(EXCLUDED_CHARS);
			}
		});

		test(`${entityType}: IDs are URL-safe`, () => {
			for (let i = 0; i < IDS_PER_TYPE; i++) {
				const id = generateId(entityType);
				expect(encodeURIComponent(id)).toBe(id);
			}
		});

		test(`${entityType}: IDs are filename-safe`, () => {
			for (let i = 0; i < IDS_PER_TYPE; i++) {
				const id = generateId(entityType);
				expect(id).not.toMatch(UNSAFE_FILENAME_CHARS);
			}
		});

		test(`${entityType}: IDs are JSON-safe`, () => {
			for (let i = 0; i < IDS_PER_TYPE; i++) {
				const id = generateId(entityType);
				expect(JSON.parse(JSON.stringify(id))).toBe(id);
			}
		});
	}
});
