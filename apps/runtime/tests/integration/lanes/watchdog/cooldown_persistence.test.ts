import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LaneRegistry } from "../../../../src/lanes/registry.js";
import { RemediationEngine } from "../../../../src/lanes/watchdog/remediation.js";
import type { ClassifiedOrphan } from "../../../../src/lanes/watchdog/resource_classifier.js";
import { InMemoryLocalBus } from "../../../../src/protocol/bus.js";

describe("Remediation cooldown persistence", () => {
  let testDir: string;
  let cooldownFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), "helios-remediation-cooldown-"));
    cooldownFile = path.join(testDir, "cooldown.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("replaces structurally invalid persisted entries with validated state", async () => {
    await writeFile(
      cooldownFile,
      JSON.stringify([{ resourceKey: 42, expiresAt: "tomorrow" }]),
      "utf-8"
    );

    const engine = new RemediationEngine(new LaneRegistry(), new InMemoryLocalBus(), {
      cooldownFile,
    });
    const orphan: ClassifiedOrphan = {
      type: "worktree",
      path: "/tmp/orphan-invalid-cooldown",
      age: 5000,
      estimatedOwner: "unknown",
      riskLevel: "medium",
      createdAt: new Date().toISOString(),
    };

    const suggestions = await engine.generateSuggestions([orphan]);
    expect(suggestions).toHaveLength(1);
    await engine.declineCleanup(suggestions[0].id);

    const persisted = JSON.parse(await readFile(cooldownFile, "utf-8"));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].resourceKey).toBe("worktree:/tmp/orphan-invalid-cooldown");
    expect(Number.isInteger(persisted[0].expiresAt)).toBe(true);
  });
});
