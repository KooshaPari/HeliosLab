import { expect, test } from "bun:test";
import { generateId, validateId } from "@helios/ids";

// Partial evidence for FR-ID-005: the package's public export is consumable by name.
// Cross-repository use by every named consumer is tracked separately and remains unchecked.
test("@helios/ids exposes a usable package API", () => {
	const id = generateId("workspace");

	expect(id).toStartWith("ws_");
	expect(validateId(id).valid).toBe(true);
});
