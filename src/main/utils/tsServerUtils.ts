import { spawn, type ChildProcess } from "child_process";
import { BUN_BINARY_PATH, TSSERVER_PATH } from "../consts/paths";
import { broadcastToWindow } from "../workspaceWindows";
import { sandboxSpawn, type SandboxProfile } from "./sandbox";

let seq = 0;
let tsServerProc: ChildProcess | undefined;

const profile: SandboxProfile = {
  version: 1,
  default_rule: "deny",
  rules: [
    { action: "allow", resource: "process*" },
    { action: "allow", resource: "mach*" },
    { action: "allow", resource: "ipc*" },
    { action: "allow", resource: "sysctl*" },
    { action: "allow", resource: "file*" },
  ],
};

process.on("exit", () => {
  tsServerProc?.kill();
});

export const tsServer = () => {
  if (tsServerProc) {
    return tsServerProc;
  }

  try {
    // Note: We cann't use fork here because tsserver doesn't currently run in bun
    // we also can't use fork because tsserver has shebangs stuff and just wants to run in node
    // Since we're not forking we can't use the node-ipc that simplifies reading/writing
    // from stdio.
    console.log("spawning tsServer");
    tsServerProc = sandboxSpawn(
      profile,
      BUN_BINARY_PATH,
      [TSSERVER_PATH, "--bun"],
      {
        // cwd should be an ancestor of the files we're working with
        cwd: "/",
      }
    );

    tsServerProc.stdout?.on("data", (data) => {
      handleTsServerStream(data);
    });

    tsServerProc.stderr?.on("data", (data) => {
      console.log("tsServer stderr", data.toString());
    });

    tsServerProc.on("close", (code) => {
      // todo (yoav): signal front-end and let user click something to re-run it
      console.warn(`tsServer: child process exited with code ${code}`);
      tsServerProc = undefined;
    });
  } catch (e) {
    console.error("tsServer error", e);
  }

  return tsServerProc;
};

export const tsServerRequest = (
  command: string,
  args: any,
  metadata: { workspaceId: string; windowId: string; editorId: string }
) => {
  // console.log("tsserver request");
  currentEditor.workspaceId = metadata.workspaceId;
  currentEditor.windowId = metadata.windowId;
  currentEditor.editorId = metadata.editorId;

  // todo (yoav): these notes are from before migrating to electrobun when forking electron's runtime worked
  // keep an eye out for dropping requests
  // Note1: we use fork here because otherwise we'd have to invoke it with a standalone node.js binary
  // Note2: tsserver would drop requests when sending multiple at a time over stdin/out
  // and they had to be spaced out by like 100ms to be reliable. Using IPC resolves that.

  tsServer()?.stdin?.write(
    JSON.stringify({
      seq: seq++,
      type: "request",
      command,
      arguments: args,
    }) + "\n"
  );
};

let tsServerResponse = {
  contentLength: 0,
  lengthReceived: 0,

  text: "",
};

const currentEditor = {
  workspaceId: "",
  windowId: "",
  editorId: "",
};

const handleTsServerStream = (data: any) => {
  // console.log("tsserver stream");
  // todo (yoav): move this to generic response handler
  const decodedText = new TextDecoder("utf-8").decode(data);

  const lines = decodedText.split("\n");

  lines.forEach((line) => {
    // skip empty lines
    // 'empty' lines can have a \r character so might have a length of 1
    if (line.length <= 2) {
      return;
    }

    if (line.startsWith("Content-Length: ")) {
      tsServerResponse.contentLength = parseInt(line.split(": ")[1]) - 1;
      return;
    }

    tsServerResponse.lengthReceived =
      tsServerResponse.lengthReceived + line.length;
    tsServerResponse.text = tsServerResponse.text + line;

    if (tsServerResponse.lengthReceived === tsServerResponse.contentLength) {
      const fullResponseText = tsServerResponse.text;
      tsServerResponse.contentLength = 0;
      tsServerResponse.lengthReceived = 0;
      tsServerResponse.text = "";

      try {
        const parsedResponse = JSON.parse(fullResponseText);
        // Note: we're gonna be super basic here and just send the response
        // to the last active editor in whatever window it was in.
        // most things should be faster than the human can switch windows or tabs
        // and make a new request
        const { workspaceId, windowId } = currentEditor;
        broadcastToWindow(workspaceId, windowId, "tsServerMessage", {
          message: parsedResponse,
          metadata: currentEditor,
        });
      } catch (e) {
        console.error("fullResponseText parse error", fullResponseText);
        return;
      }
    } else {
      // partial response
    }
  });
};
