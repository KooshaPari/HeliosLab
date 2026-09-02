import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";

describe("Worktree remediation snapshot persistence", () => {
  let testDir: string;
  let snapshotDirectory: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), "helios-remediation-snapshot-"));
    snapshotDirectory = path.join(testDir, "configured-snapshots");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes an atomic snapshot with a safe filename for an untrusted owner", async () => {
    const engine = new RemediationEngine(new LaneRegistry(), new InMemoryLocalBus(), {
      cooldownFile: path.join(testDir, "cooldown.json"),
      snapshotDirectory,
    });
    const orphan: ClassifiedOrphan = {
      type: "worktree",
      path: path.join(testDir, "missing-worktree"),
      age: 5000,
      estimatedOwner: "../../lane:unsafe?\\name",
      riskLevel: "high",
      createdAt: new Date().toISOString(),
    };

    const suggestions = await engine.generateSuggestions([orphan]);
    await engine.confirmCleanup(suggestions[0].id);

    const entries = await readdir(snapshotDirectory, { withFileTypes: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].isFile()).toBe(true);
    expect(entries[0].name).toMatch(/^\d+-[a-f0-9-]+-[A-Za-z0-9._-]+\.json$/);

    const snapshot = JSON.parse(
      await readFile(path.join(snapshotDirectory, entries[0].name), "utf-8")
    );
    expect(snapshot.path).toBe(orphan.path);
    expect(snapshot.estimatedOwner).toBe(orphan.estimatedOwner);
  });
});
