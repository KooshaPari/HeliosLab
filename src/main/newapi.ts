import * as path from "path";
// XXX - temp getAppPath
export const getAppPath = () => {
  return path.resolve("../Resources/");
};
// XXX - temp getVersion
export const getVersion = () => {
  return "1.0.0";
};

export const getPath = (name: string) => {
  if (name === "home") {
    console.log("getPath", process.env["HOME"], path.resolve("~"));
    return process.env["HOME"] || path.resolve("~");
  } else {
    return "";
  }
};
