/**
 * FR-HELIOS-045: Session Checkpoint Store Tests
 * Verifies: FR-CRH-003 (zmx checkpoints for session restoration)
 */
import { describe, expect, test } from "bun:test";
import { Slice1CheckpointStorePlaceholder } from "../../../src/sessions/checkpoint_store";

describe("checkpoint store placeholder", () => {
  test("stays non-operational in slice-1", async () => {
    const store = new Slice1CheckpointStorePlaceholder();
    await expect(store.save({} as never)).rejects.toThrow("slice_2_durability_not_implemented");
    await expect(store.latest("session-1")).resolves.toBeNull();
    await expect(store.list("session-1")).resolves.toEqual([]);
  });
});
