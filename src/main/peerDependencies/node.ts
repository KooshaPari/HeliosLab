import { existsSync, renameSync, unlinkSync } from "fs";
import { execSpawnSync } from "../utils/processUtils";
import {
  BUN_BINARY_PATH,
  NODE_BINARY_PATH,
  NPM_BINARY_PATH,
  BUN_PATH,
} from "../consts/paths";
import { join } from "path";

const NODE_VERSION = "20.10.0";

// We don't use node.js, but some npm packages like webflow cli depend on it as a peerDependency
// so it needs to exist on the PATH which only includes egbbunhome/.deps folder

export const isInstalled = () => {
  return existsSync(NODE_BINARY_PATH) && getVersion() === NODE_VERSION;
};

let _version: string = "";
export const getVersion = (forceRefetch = false) => {
  if (!forceRefetch && _version) {
    return _version;
  }

  if (!existsSync(NODE_BINARY_PATH)) {
    return null;
  }
  // comes back as v20.10.0
  const result = execSpawnSync(NODE_BINARY_PATH, ["--version"]);
  const versionResult = (result.stdout || "").slice(1).trim();
  return versionResult;
};

export const install = () => {
  if (isInstalled()) {
    return;
  }

  // curl -L https://nodejs.org/dist/v20.10.0/node-v20.10.0-darwin-x64.tar.gz | tar -xz
  // let installResult1 = execSpawnSync(BUN_BINARY_PATH, [
  //   "add",
  //   "--exact",
  //   `node@${NODE_VERSION}`,
  // ]);
  // console.log("installResult1", installResult1);
  const foldername = `node-v${NODE_VERSION}-darwin-${process.arch}`;
  const downloadURl = `https://nodejs.org/dist/v${NODE_VERSION}/${foldername}.tar.gz`;
  const installResult = execSpawnSync(
    "curl",
    ["-L", downloadURl, "|", "tar", "-xz"],
    { shell: true }
  );

  const nodeInstalledBinaryFolder = join(BUN_PATH, foldername, "bin");
  const nodeInstalledBinPath = join(nodeInstalledBinaryFolder, "node");
  const npmInstalledBinPath = join(nodeInstalledBinaryFolder, "npm");

  if (existsSync(NODE_BINARY_PATH)) {
    unlinkSync(NODE_BINARY_PATH);
  }

  if (existsSync(nodeInstalledBinPath)) {
    renameSync(nodeInstalledBinPath, NODE_BINARY_PATH);
  }

  if (existsSync(NPM_BINARY_PATH)) {
    unlinkSync(NPM_BINARY_PATH);
  }

  if (existsSync(npmInstalledBinPath)) {
    renameSync(npmInstalledBinPath, NPM_BINARY_PATH);
  }

  // invalidate the cache
  getVersion(true);

  console.info("node installResult", installResult);
};
