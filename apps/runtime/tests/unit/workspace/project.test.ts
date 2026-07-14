/**
 * FR-HELIOS-074: Project Binding Tests
 * Verifies: FR-PER-003 (Project binding), FR-PER-004 (Root path validation), FR-PER-005 (Persistence)
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindLocalProject,
  bindGitProject,
  unbindProject,
  detectStaleProjects,
  gitClone,
} from "../../../src/workspace/project.js";
import { createWorkspace } from "../../../src/workspace/workspace.js";
import type { Workspace } from "../../../src/workspace/types.js";

let tempDir: string;
let ws: Workspace;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wp02-test-"));
  ws = createWorkspace({ name: "TestWS", rootPath: "/tmp/ws" });
});

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true });
    // eslint-disable-next-line no-unused-vars
  } catch (_err) {
    // cleanup best-effort
  }
});

// ── bindLocalProject ────────────────────────────────────────────────

describe("bindLocalProject", () => {
  // FR-003
  test("binds an accessible absolute path", () => {
    const updated = bindLocalProject(ws, tempDir);
    expect(updated.projects).toHaveLength(1);
    expect(updated.projects[0]!.status).toBe("active");
    expect(updated.projects[0]!.id).toMatch(/^proj_/);
    expect(updated.projects[0]!.workspaceId).toBe(ws.id);
  });

  // FR-004
  test("rejects relative path", () => {
    expect(() => bindLocalProject(ws, "relative/path")).toThrow("must be absolute");
  });

  // FR-004
  test("rejects inaccessible path", () => {
    expect(() => bindLocalProject(ws, "/nonexistent/path/xyz")).toThrow("not accessible");
  });

  test("rejects duplicate rootPath", () => {
    const updated = bindLocalProject(ws, tempDir);
    expect(() => bindLocalProject(updated, tempDir)).toThrow("already bound");
  });

  test("resolves symlinks before storing", () => {
    const realDir = join(tempDir, "real");
    mkdirSync(realDir);
    const linkPath = join(tempDir, "link");
    symlinkSync(realDir, linkPath);

    const updated = bindLocalProject(ws, linkPath);
    expect(updated.projects[0]!.rootPath).toBe(realpathSync(realDir));
  });

  test("path with spaces works", () => {
    const spacePath = join(tempDir, "path with spaces");
    mkdirSync(spacePath);
    const updated = bindLocalProject(ws, spacePath);
    expect(updated.projects[0]!.rootPath).toContain("path with spaces");
  });

  test("does not mutate original workspace", () => {
    const updated = bindLocalProject(ws, tempDir);
    expect(ws.projects).toHaveLength(0);
    expect(updated.projects).toHaveLength(1);
  });
});

// ── unbindProject ───────────────────────────────────────────────────

describe("unbindProject", () => {
  test("removes existing binding", () => {
    const bound = bindLocalProject(ws, tempDir);
    const projectId = bound.projects[0]!.id;
    const unbound = unbindProject(bound, projectId);
    expect(unbound.projects).toHaveLength(0);
  });

  test("throws for nonexistent project ID", () => {
    expect(() => unbindProject(ws, "proj_fake")).toThrow("not found");
  });
});

// ── detectStaleProjects ─────────────────────────────────────────────

describe("detectStaleProjects", () => {
  // FR-009
  test("accessible path stays active", async () => {
    const bound = bindLocalProject(ws, tempDir);
    const checked = await detectStaleProjects(bound);
    expect(checked.projects[0]!.status).toBe("active");
  });

  // FR-009
  test("missing path becomes stale", async () => {
    const bound = bindLocalProject(ws, tempDir);
    // Remove the directory and wait for filesystem to settle
    try {
      rmSync(tempDir, { recursive: true });
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      // Best-effort removal; test checks stale detection regardless
    }
    // Small delay to ensure filesystem sync
    await new Promise(resolve => setTimeout(resolve, 10));
    const checked = await detectStaleProjects(bound);
    expect(checked.projects[0]!.status).toBe("stale");
  });

  // FR-009
  test("recovered path auto-heals to active", async () => {
    const bound = bindLocalProject(ws, tempDir);
    // Manually set to stale
    const staleWs: Workspace = {
      ...bound,
      projects: bound.projects.map(p => ({ ...p, status: "stale" as const })),
    };
    // Path still exists, so it should heal
    const healed = await detectStaleProjects(staleWs);
    expect(healed.projects[0]!.status).toBe("active");
  });

  test("returns same workspace if nothing changed", async () => {
    const bound = bindLocalProject(ws, tempDir);
    const checked = await detectStaleProjects(bound);
    expect(checked).toBe(bound);
  });
});

// ── gitClone (mocked) ──────────────────────────────────────────────

describe("gitClone", () => {
  test("throws actionable error when git missing", async () => {
    // We test the real function but with an invalid URL
    // to verify error handling — actual network tests are integration only
    const targetDir = join(tempDir, "clone-target");
    await expect(gitClone("not-a-real-url", targetDir, 5000)).rejects.toThrow();
  });
});

// ── bindGitProject (integration-level, mocked spawn) ────────────────

describe("bindGitProject", () => {
  test("rejects relative target directory", async () => {
    await expect(
      bindGitProject(ws, "https://example.com/repo.git", "relative/path")
    ).rejects.toThrow("must be absolute");
  });
});
