import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createTestCooldownFile(): string {
  return path.join(os.tmpdir(), `helios-remediation-cooldown-${process.pid}-${randomUUID()}.json`);
}

export async function removeTestCooldownFile(cooldownFile: string): Promise<void> {
  await rm(cooldownFile, { force: true });
}
