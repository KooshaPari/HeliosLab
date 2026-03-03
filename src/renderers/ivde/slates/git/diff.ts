import { join } from "../../../utils/pathUtils";

export type GitShowRequest = (args: {
	options: string[];
	repoRoot: string;
}) => Promise<string | undefined>;
export type FileExistsRequest = (args: {
	path: string;
}) => Promise<boolean | undefined>;
export type ReadFileRequest = (args: {
	path: string;
}) => Promise<{ textContent?: string } | undefined>;

type GetFileDiffArgs = {
	filepath: string;
	commitHash?: string;
	changeType?: string;
	isStaged?: boolean;
};

type FileContentRequests = {
	gitShow?: GitShowRequest;
	exists?: FileExistsRequest;
	readFile?: ReadFileRequest;
};

export const createGitContentReader = (
	repoRootPath: string,
	requests: FileContentRequests,
) => {
	const getFileContents = async (filepath: string, commitRef = "HEAD") => {
		if (commitRef === "WORKING") {
			const absolutePath = join(repoRootPath, filepath);
			const exists = await requests.exists?.({ path: absolutePath });
			if (!exists) {
				return "";
			}
			const result = await requests.readFile?.({ path: absolutePath });
			return result?.textContent || "";
		}
		if (commitRef === "INDEX") {
			const content = await requests
				.gitShow?.({
					options: [`:${filepath}`],
					repoRoot: repoRootPath,
				})
				.catch(() => "");
			return content || "";
		}
		if (commitRef !== "HEAD") {
			const content = await requests
				.gitShow?.({
					options: [`${commitRef}:${filepath}`],
					repoRoot: repoRootPath,
				})
				.catch(() => "");
			return content || "";
		}
		const content = await requests
			.gitShow?.({
				options: [`HEAD:${filepath}`],
				repoRoot: repoRootPath,
			})
			.catch(() => "");
		return content || "";
	};

	const getFileDiff = async ({
		filepath,
		commitHash = "HEAD",
		changeType,
		isStaged = false,
	}: GetFileDiffArgs) => {
		if (commitHash === "HEAD") {
			if (isStaged) {
				if (changeType === "A") {
					const modifiedText = await getFileContents(filepath, "INDEX");
					return { originalText: "", modifiedText: modifiedText || "" };
				}
				if (changeType === "D") {
					const originalText = await getFileContents(filepath, "HEAD");
					return { originalText: originalText || "", modifiedText: "" };
				}
				const [originalText, modifiedText] = await Promise.all([
					getFileContents(filepath, "HEAD"),
					getFileContents(filepath, "INDEX"),
				]);
				return {
					originalText: originalText || "",
					modifiedText: modifiedText || "",
				};
			}

			if (changeType === "A") {
				const modifiedText = await getFileContents(filepath, "WORKING");
				return { originalText: "", modifiedText: modifiedText || "" };
			}
			if (changeType === "D") {
				const originalText = await getFileContents(filepath, "HEAD");
				return { originalText: originalText || "", modifiedText: "" };
			}
			const [originalText, modifiedText] = await Promise.all([
				getFileContents(filepath, "INDEX"),
				getFileContents(filepath, "WORKING"),
			]);
			return {
				originalText: originalText || "",
				modifiedText: modifiedText || "",
			};
		}

		if (changeType === "A") {
			const modifiedText = await getFileContents(filepath, commitHash);
			return { originalText: "", modifiedText: modifiedText || "" };
		}
		if (changeType === "D") {
			const originalText = await getFileContents(filepath, `${commitHash}^`);
			return { originalText: originalText || "", modifiedText: "" };
		}
		const [originalText, modifiedText] = await Promise.all([
			getFileContents(filepath, `${commitHash}^`),
			getFileContents(filepath, commitHash),
		]);
		return {
			originalText: originalText || "",
			modifiedText: modifiedText || "",
		};
	};

	return { getFileContents, getFileDiff };
};
