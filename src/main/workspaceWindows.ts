// Ephemeral workspace/window state
// todo (yoav): replace this with solidjs ephemeral store? and possibly add subscription / syncing to the front-end
export let workspaceWindows: {
  [id: string]: {
    [id: string]: {
      id: string;
      // YYY - use type
      win: any;
      // portalChannel: any;
      status: "open" | "hiding";
    };
  };
} = {};

// Track the currently focused window
let focusedWindowInfo: { workspaceId: string; windowId: string } | null = null;

export const setFocusedWindow = (workspaceId: string, windowId: string) => {
  console.log(`setFocusedWindow: workspace=${workspaceId}, window=${windowId}`);
  focusedWindowInfo = { workspaceId, windowId };
};

export const clearFocusedWindow = (workspaceId: string, windowId: string) => {
  // Only clear if this window is the currently focused one
  if (focusedWindowInfo?.workspaceId === workspaceId && focusedWindowInfo?.windowId === windowId) {
    focusedWindowInfo = null;
  }
};

export const getFocusedWindow = () => focusedWindowInfo;

export const broadcastToAllWindowsInWorkspace = (workspaceId: string, type: string, data: any) => {
  const activeWorkspaceWindows = workspaceWindows[workspaceId];

  for (const windowId in activeWorkspaceWindows) {
    const { win } = activeWorkspaceWindows[windowId];

    win.webview?.rpc.send(type, data);
  }
};

export const broadcastToAllWindows = (type: string, data: any) => {
  for (const workspaceId in workspaceWindows) {
    broadcastToAllWindowsInWorkspace(workspaceId, type, data);
  }
};

export const broadcastToWindow = (
  workspaceId: string,
  windowId: string,
  type: string,
  data: any,
) => {
  const activeWorkspaceWindows = workspaceWindows[workspaceId];
  const { win } = activeWorkspaceWindows[windowId];
  win.webview?.rpc.send(type, data);
};

// Send message to only the focused window, or fall back to all windows if none focused
export const sendToFocusedWindow = (type: string, data: any) => {
  console.log(`sendToFocusedWindow: type=${type}, focusedWindowInfo=`, focusedWindowInfo);
  if (focusedWindowInfo) {
    const { workspaceId, windowId } = focusedWindowInfo;
    const activeWorkspaceWindows = workspaceWindows[workspaceId];
    if (activeWorkspaceWindows?.[windowId]) {
      console.log(`sendToFocusedWindow: sending to workspace=${workspaceId}, window=${windowId}`);
      activeWorkspaceWindows[windowId].win.webview?.rpc.send(type, data);
      return;
    }
  }
  // Fallback: if no focused window tracked, send to all (shouldn't normally happen)
  console.log(`sendToFocusedWindow: no focused window, falling back to broadcast`);
  broadcastToAllWindows(type, data);
};
