import { type FSWatcher, existsSync, statSync, watch } from "fs";
import { join } from "path";
import { makeFileNameSafe } from "../shared/utils/files";
import { COLAB_HOME_FOLDER } from "./consts/paths";
import db, { type CurrentDocumentTypes } from "./goldfishdb/db";
import { readSlateConfigFile } from "./utils/fileUtils";
import { broadcastToAllWindows, broadcastToAllWindowsInWorkspace } from "./workspaceWindows";

const directoryWatchers: { [projectId: string]: FSWatcher | null } = {};

export const closeProjectDirectoryWatcher = (projectId: string) => {
  directoryWatchers[projectId]?.close();
};

export const removeProjectDirectoryWatcher = (projectId: string) => {
  closeProjectDirectoryWatcher(projectId);
  directoryWatchers[projectId] = null;
  // Note: typically when removing we moved folders around so we want to make sure
  // that we're watching all the directories we need to as well, possibly for the same project.
  // This is like a refresh
  watchProjectDirectories();
};

export const watchProjectDirectories = () => {
  if (!COLAB_HOME_FOLDER) {
    throw new Error("Must set COLAB_HOME_FOLDER in state.paths");
  }

  const { data: projects } = db.collection("projects").query();

  for (const index in projects) {
    const project = projects[index];
    const projectId = project.id;

    const fileWatcher = directoryWatchers[String(projectId)];
    // TODO: consider moving to project create/edit
    const projectDirectory =
      project.path || join(COLAB_HOME_FOLDER, makeFileNameSafe(project.name || project.id));

    if (!existsSync(projectDirectory)) {
      // TODO: create the project directory now, but move to add/edit when choosing a project path in the future just exit here
      // mkdirSync(projectDirectory, { recursive: true });
      continue;
    }

    const { data: workspaces } = db.collection("workspaces").query({
      where: (workspace) => {
        return workspace.projectIds.includes(projectId);
      },
    });

    const workspaceId = workspaces?.[0]?.id;

    if (!workspaceId) {
      continue;
    }

    // Add a fileWatcher for each project whenever projects are added

    if (!fileWatcher) {
      const fileWatcher = watch(
        projectDirectory,
        { recursive: true },
        (eventType, relativePath) => {
          /* Notes:
              Rename:
                * A file rename triggers this twice, once for the old filepath and once for the new filepath
              Move:
                * Same for file moves

            */
          if (!relativePath) {
            console.log("fileWatcher relative path empty: ", relativePath);
            return;
          }

          const absolutePath = join(projectDirectory, relativePath);
          // file was removed (or moved or renamed to something else)
          const exists = existsSync(absolutePath);
          const isDelete = eventType === "rename" && !exists;
          const isAdding = eventType === "rename" && exists;
          const projectWasDeleted = isDelete && projectDirectory === absolutePath;

          if (projectWasDeleted) {
            // stop watching the folder
            fileWatcher.close();
            directoryWatchers[projectId] = null;
            return;
          }

          // Ignore node_modules to prevent performance issues during npm/bun install
          if (absolutePath.includes("/node_modules/")) {
            return;
          }

          let stat = null;
          if (exists) {
            try {
              stat = statSync(absolutePath);
            } catch {
              // File may have been deleted between the watch event and statSync
              return;
            }
          }

          broadcastToAllWindowsInWorkspace(workspaceId, "fileWatchEvent", {
            absolutePath,
            exists,
            isDelete,
            isAdding,
            isFile: Boolean(stat?.isFile()),
            isDir: Boolean(stat?.isDirectory()),
          });
        },
      );

      directoryWatchers[project.id] = fileWatcher;
    }
  }
};
