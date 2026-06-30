// FR-004 — Collision resistance test
// Generates 10M IDs across 8 concurrent contexts and asserts zero collisions.
import { describe, test, expect } from "bun:test";
import { generateId, validateId } from "../src/index.js";
import type { EntityType } from "../src/index.js";

const TOTAL_IDS = 10_000_000;
const CONCURRENCY = 8;
const IDS_PER_CONTEXT = TOTAL_IDS / CONCURRENCY;

describe("collision resistance", () => {
	test(
		"10M IDs across 8 concurrent contexts produce zero collisions",
		async () => {
			const entityTypes: EntityType[] = [
				"workspace",
				"lane",
				"session",
				"terminal",
				"run",
				"correlation",
			];

			// Generate IDs in concurrent batches
			const batches = Array.from({ length: CONCURRENCY }, (_, batchIdx) =>
				(async () => {
					const ids: string[] = new Array(IDS_PER_CONTEXT);
					for (let i = 0; i < IDS_PER_CONTEXT; i++) {
						ids[i] = generateId(entityTypes[i % entityTypes.length]);
					}
					return ids;
				})(),
			);

			const results = await Promise.all(batches);
			const allIds = results.flat();

			expect(allIds.length).toBe(TOTAL_IDS);

			// Check for collisions using a Set
			const uniqueSet = new Set(allIds);
			expect(uniqueSet.size).toBe(TOTAL_IDS);

			// Validate a sample (validating all 10M would be slow)
			const sampleSize = 10_000;
			for (let i = 0; i < sampleSize; i++) {
				const idx = Math.floor(Math.random() * allIds.length);
				const result = validateId(allIds[idx]);
				expect(result.valid).toBe(true);
			}
		},
		{ timeout: 60_000 },
	);
});
