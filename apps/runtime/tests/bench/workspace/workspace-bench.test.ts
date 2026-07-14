// T016 — Performance benchmarks for workspace persistence
// SLO: CRUD < 100ms (p95), restore < 500ms (p95) for 50 workspaces

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createJsonStore } from "../../../src/workspace/store.js";
import type { Workspace } from "../../../src/workspace/types.js";

// CI machines may be slower — 2x factor
const CI_FACTOR = process.env["CI"] ? 2 : 1;

function makeWorkspace(i: number): Workspace {
  return {
    id: `ws_bench_${i}`,
    name: `Bench-Workspace-${i}`,
    rootPath: `/home/user/projects/workspace-${i}`,
    state: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projects: Array.from({ length: 10 }, (_, j) => ({
      id: `proj_${i}_${j}`,
      workspaceId: `ws_bench_${i}`,
      rootPath: `/home/user/projects/workspace-${i}/project-${j}`,
      gitUrl: `https://github.com/user/project-${j}.git`,
      status: "active" as const,
      boundAt: Date.now(),
    })),
  };
}

async function measure(fn: () => Promise<void>, iterations: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b);
}

function p95(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[idx]!;
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "wp03-bench-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("Workspace persistence benchmarks", () => {
  test("create operation p95 < 100ms", async () => {
    const store = await createJsonStore(dataDir);
    const times = await measure(async () => {
      const ws = makeWorkspace(Math.floor(Math.random() * 100000));
      await store.save(ws);
    }, 20);

    const p95Val = p95(times);
    console.log(`Create p95: ${p95Val.toFixed(2)}ms`);
    expect(p95Val).toBeLessThan(100 * CI_FACTOR);
  });

  test("flush with 50 workspaces p95 < 200ms", async () => {
    const store = await createJsonStore(dataDir);
    // Seed 50 workspaces
    for (let i = 0; i < 50; i++) {
      await store.save(makeWorkspace(i));
    }

    const times = await measure(async () => {
      await store.flush();
    }, 20);

    const p95Val = p95(times);
    console.log(`Flush (50 ws) p95: ${p95Val.toFixed(2)}ms`);
    expect(p95Val).toBeLessThan(200 * CI_FACTOR);
  });

  test("restore from file with 50 workspaces x 10 projects p95 < 500ms", async () => {
    // Create and save 50 workspaces
    const store = await createJsonStore(dataDir);
    for (let i = 0; i < 50; i++) {
      await store.save(makeWorkspace(i));
    }

    const times = await measure(async () => {
      await createJsonStore(dataDir);
    }, 20);

    const p95Val = p95(times);
    console.log(`Restore (50 ws) p95: ${p95Val.toFixed(2)}ms`);
    expect(p95Val).toBeLessThan(500 * CI_FACTOR);
  });
});
