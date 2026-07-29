// T001 — Workspace and store types

/** Valid workspace lifecycle states */
export type WorkspaceState = "active" | "closed" | "deleted";

/** A project bound to a workspace */
export interface ProjectBinding {
  id: string;
  workspaceId: string;
  rootPath: string;
  gitUrl?: string | undefined;
  status: "active" | "stale";
  boundAt: number;
}

/** Core workspace entity */
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  state: WorkspaceState;
  createdAt: number;
  updatedAt: number;
  projects: ProjectBinding[];
}

/** Input for creating a new workspace */
export interface CreateWorkspaceInput {
  name: string;
  rootPath: string;
}

/** Backend-agnostic persistence interface */
export interface WorkspaceStore {
  getAll(): Promise<Workspace[]>;
  getById(id: string): Promise<Workspace | undefined>;
  getByName(name: string): Promise<Workspace | undefined>;
  save(workspace: Workspace): Promise<void>;
  remove(id: string): Promise<void>;
  flush(): Promise<void>;
}
