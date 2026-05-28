import {
  existsSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { execSpawnSync } from "../utils/processUtils";
import {
  BUN_BINARY_PATH,
  TYPESCRIPT_PACKAGE_PATH,
  TSSERVER_PATH,
} from "../consts/paths";
import { join } from "path";

const TYPESCRIPT_VERSION = "5.3.3";

export const isInstalled = () => {
  return existsSync(TSSERVER_PATH) && getVersion() === TYPESCRIPT_VERSION;
};

let _version: string = "";
export const getVersion = (forceRefetch = false) => {
  if (!forceRefetch && _version) {
    return _version;
  }

  const packgeJsonPath = join(TYPESCRIPT_PACKAGE_PATH, "package.json");

  if (!existsSync(packgeJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(join(TYPESCRIPT_PACKAGE_PATH, "package.json"), "utf8")
    );
    _version = packageJson.version;
    return _version;
  } catch (e) {
    console.error("error reading package.json", e);
  }
};

export const install = () => {
  if (isInstalled()) {
    return;
  }

  const installResult = execSpawnSync(BUN_BINARY_PATH, [
    "install",
    "--exact",
    `typescript@${TYPESCRIPT_VERSION}`,
  ]);

  // invalidate the cache
  getVersion(true);

  const installedTsserverPath = join(
    TYPESCRIPT_PACKAGE_PATH,
    "lib",
    "tsserver.js"
  );
  if (existsSync(TSSERVER_PATH)) {
    unlinkSync(TSSERVER_PATH);
  }

  if (existsSync(installedTsserverPath)) {
    symlinkSync(installedTsserverPath, TSSERVER_PATH);
  }
  console.info("typescript installResult", installResult);
};
