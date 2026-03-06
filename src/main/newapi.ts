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
    const homePath = process.env.HOME;
    console.log("getPath", homePath, path.resolve("~"));
    return homePath ?? path.resolve("~");
  }
  return "";
};
