// T006, T007, T008 — Project binding, stale detection, and git clone delegation

import type { Workspace, ProjectBinding } from "./types.js";
import { existsSync, realpathSync, accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";

// Stub ID generator — uses spec 005 format proj_{ulid}
function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `proj_${timestamp}${random}`;
}

/**
 * Bind a local directory as a project in a workspace.
 * Validates rootPath is absolute and accessible, rejects duplicates.
 */
export function bindLocalProject(workspace: Workspace, rootPath: string): Workspace {
  if (!isAbsolute(rootPath)) {
    throw new Error("Project rootPath must be absolute");
  }

  // Resolve symlinks to canonical path
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(rootPath);
  } catch {
    throw new Error(`Project rootPath is not accessible: ${rootPath}`);
  }

  // Check accessibility
  try {
    accessSync(resolvedPath, constants.R_OK);
  } catch {
    throw new Error(`Project rootPath is not accessible: ${rootPath}`);
  }

  // Duplicate check
  if (workspace.projects.some(p => p.rootPath === resolvedPath)) {
    throw new Error(`Project with rootPath '${resolvedPath}' is already bound to this workspace`);
  }

  const binding: ProjectBinding = {
    id: generateProjectId(),
    workspaceId: workspace.id,
    rootPath: resolvedPath,
    gitUrl: undefined,
    status: "active",
    boundAt: Date.now(),
  };

  return {
    ...workspace,
    projects: [...workspace.projects, binding],
    updatedAt: Date.now(),
  };
}

/**
 * Bind a git repository by cloning it, then recording the binding.
 */
export async function bindGitProject(
  workspace: Workspace,
  gitUrl: string,
  targetDir: string
): Promise<Workspace> {
  if (!isAbsolute(targetDir)) {
    throw new Error("Target directory must be absolute");
  }

  await gitClone(gitUrl, targetDir);

  const resolvedPath = realpathSync(targetDir);

  // Duplicate check
  if (workspace.projects.some(p => p.rootPath === resolvedPath)) {
    throw new Error(`Project with rootPath '${resolvedPath}' is already bound to this workspace`);
  }

  const binding: ProjectBinding = {
    id: generateProjectId(),
    workspaceId: workspace.id,
    rootPath: resolvedPath,
    gitUrl,
    status: "active",
    boundAt: Date.now(),
  };

  return {
    ...workspace,
    projects: [...workspace.projects, binding],
    updatedAt: Date.now(),
  };
}

/**
 * Remove a project binding from a workspace.
 */
export function unbindProject(workspace: Workspace, projectId: string): Workspace {
  const idx = workspace.projects.findIndex(p => p.id === projectId);
  if (idx === -1) {
    throw new Error(`Project '${projectId}' not found in workspace`);
  }

  return {
    ...workspace,
    projects: workspace.projects.filter(p => p.id !== projectId),
    updatedAt: Date.now(),
  };
}

/**
 * Detect stale project bindings by checking rootPath accessibility.
 * Auto-heals previously stale paths that are now accessible.
 */
export async function detectStaleProjects(workspace: Workspace): Promise<Workspace> {
  const updatedProjects = workspace.projects.map((binding): ProjectBinding => {
    try {
      accessSync(binding.rootPath, constants.R_OK);
      // Accessible — mark active (auto-heal if was stale)
      return binding.status === "active" ? binding : { ...binding, status: "active" };
    } catch {
      // Inaccessible — mark stale
      if (binding.status === "stale") return binding;
      return { ...binding, status: "stale" };
    }
  });

  const changed = updatedProjects.some((p, i) => p.status !== workspace.projects[i]!.status);

  if (!changed) return workspace;

  return {
    ...workspace,
    projects: updatedProjects,
    updatedAt: Date.now(),
  };
}

/**
 * Clone a git repository using system git binary.
 */
export async function gitClone(
  url: string,
  targetDir: string,
  timeoutMs: number = 120_000
): Promise<void> {
  // Check git availability
  try {
    const versionProc = Bun.spawn(["git", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await versionProc.exited;
    if (versionProc.exitCode !== 0) {
      throw new Error("git binary not functional");
    }
  } catch {
    throw new Error("git is not available on this system. Install git to clone repositories.");
  }

  const proc = Bun.spawn(["git", "clone", url, targetDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git clone failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  // Validate target exists
  if (!existsSync(targetDir)) {
    throw new Error(`git clone reported success but target directory does not exist: ${targetDir}`);
  }
}
