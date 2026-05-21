import type { FileNodeType } from "../../shared/types/types";
import { join } from "../utils/pathUtils";
import { getNode } from "./FileWatcher";

type RepoCloneWatcherArgs = {
	previewNode: FileNodeType;
	onExpandRepo: (repoPath: string) => void;
	onOpenGitSlate: (gitPath: string) => void;
};

const POLL_INTERVAL_MS = 500;
const MAX_REPO_POLL_ATTEMPTS = 20;
const MAX_GIT_POLL_ATTEMPTS = 20;

export const watchClonedRepoAndOpenGitSlate = ({
	previewNode,
	onExpandRepo,
	onOpenGitSlate,
}: RepoCloneWatcherArgs): void => {
	let repoPollAttempts = 0;

	const pollForGitDirectory = (gitFolderPath: string) => {
		let gitPollAttempts = 0;

		const openGitSlateWhenReady = () => {
			gitPollAttempts += 1;
			const gitNode = getNode(gitFolderPath);
			console.log(
				`Git folder poll attempt ${gitPollAttempts}, found:`,
				gitNode ? "yes" : "no",
			);
			if (gitNode) {
				console.log("Opening git slate for:", gitFolderPath);
				onOpenGitSlate(gitFolderPath);
				return;
			}
			if (gitPollAttempts < MAX_GIT_POLL_ATTEMPTS) {
				setTimeout(openGitSlateWhenReady, POLL_INTERVAL_MS);
				return;
			}
			console.log("Timeout waiting for .git folder");
		};

		openGitSlateWhenReady();
	};

	const expandWhenReady = () => {
		repoPollAttempts += 1;
		const node = getNode(previewNode.path);
		if (node) {
			console.log("Found repo node, expanding:", previewNode.path);
			onExpandRepo(previewNode.path);
			const gitFolderPath = join(previewNode.path, ".git");
			console.log("Looking for git folder at:", gitFolderPath);
			pollForGitDirectory(gitFolderPath);
			return;
		}
		if (repoPollAttempts < MAX_REPO_POLL_ATTEMPTS) {
			setTimeout(expandWhenReady, POLL_INTERVAL_MS);
			return;
		}
		console.log("Timeout waiting for cloned repo to appear in file tree");
	};

	expandWhenReady();
};
