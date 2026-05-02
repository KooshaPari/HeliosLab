export type GitChangeCode = "A" | "M" | "D" | "?" | "";

export type FileChangeType = {
	changeType: GitChangeCode;
	relPath: string;
};

export type FileChangesType = Record<string, FileChangeType>;

export type FileChangeWithCommitType = FileChangeType & {
	commitHash: string;
	isFromStaged?: boolean;
};

export type StashInfo = {
	hash?: string;
	index?: string;
	message?: string;
	date?: string;
};

export type UncommittedChangesType = {
	staged: FileChangesType;
	unstaged: FileChangesType;
	shortStat: string;
};

export type CommitType = {
	author: string;
	date: number;
	hash: string;
	files: FileChangesType;
	message: string;
	shortStat: string;
	refs: string[];
	isRemoteOnly?: boolean;
};

export type RemoteType = {
	name: string;
	refs: {
		fetch: string;
		push: string;
	};
};

export type BranchInfo = {
	current: string;
	all: string[];
	remote: string[];
	trackingBranch?: string;
};

export type SyncStatusType = {
	ahead: number;
	behind: number;
};

export type GitUiStateType = {
	changes: UncommittedChangesType;
	log: CommitType[];
	stashes: { all: StashInfo[]; latest: StashInfo | null; total: number };
	originalText: string;
	modifiedText: string;
	remotes: RemoteType[];
	branches: BranchInfo;
	syncStatus: SyncStatusType;
	activeSection: "branches" | "remotes" | "stashes";
};
