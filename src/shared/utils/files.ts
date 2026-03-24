export const makeFileNameSafe = (s: string) => {
  return s.replaceAll(/[^a-z0-9._]/gi, "-").toLowerCase();
};

export const isPathSafe = (absolutePath: string) => {
  // Eg: /Users/yoav/colab/projectfolder
  // Eg: /Users/yoav/code/projectfolder
  // Todo (yoav): add more checks for system folders and handle leading slash
  if (absolutePath.split("/").length >= 4) {
    return true;
  }

  return false;
};
