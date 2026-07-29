import type { Component } from "solid-js";
import { Show, createSignal } from "solid-js";
import { Sidebar } from "./sidebar/Sidebar";
import { StatusBar } from "./common/StatusBar";
import { getAppState } from "../stores/app.store";

const TERMINAL_MIN_HEIGHT = 80;
const TERMINAL_DEFAULT_HEIGHT = 220;

export const AppShell: Component = () => {
  const state = getAppState;
  const [terminalHeight, setTerminalHeight] = createSignal(TERMINAL_DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = createSignal(false);

  function onDragHandleMouseDown(e: MouseEvent): void {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startHeight = terminalHeight();

    function onMouseMove(mv: MouseEvent): void {
      const delta = startY - mv.clientY;
      const newHeight = Math.max(TERMINAL_MIN_HEIGHT, startHeight + delta);
      setTerminalHeight(newHeight);
    }

    function onMouseUp(): void {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100vh",
        width: "100vw",
        "background-color": "#1e1e2e",
        color: "#cdd6f4",
        "font-family": "'JetBrains Mono', 'Fira Code', monospace",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: "1",
          overflow: "hidden",
        }}
      >
        <Show when={state().sidebarVisible}>
          <Sidebar />
        </Show>

        <div
          style={{
            flex: "1",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
            "background-color": "#1e1e2e",
          }}
        >
          <div
            style={{
              flex: "1",
              overflow: "auto",
              padding: "24px",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: "#6c7086",
              "font-size": "14px",
            }}
          >
            <span>Select or start a conversation</span>
          </div>

          <Show when={state().terminalVisible}>
            <div
              onMouseDown={onDragHandleMouseDown}
              style={{
                height: "6px",
                "min-height": "6px",
                cursor: "ns-resize",
                "background-color": isDragging() ? "#89b4fa" : "#313244",
                "border-top": "1px solid #45475a",
                transition: isDragging() ? "none" : "background-color 0.15s ease",
                "flex-shrink": "0",
              }}
            />
            <div
              style={{
                height: `${terminalHeight()}px`,
                "min-height": `${TERMINAL_MIN_HEIGHT}px`,
                "background-color": "#11111b",
                "border-top": "1px solid #313244",
                "flex-shrink": "0",
                overflow: "hidden",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "#6c7086",
                "font-size": "12px",
              }}
            >
              <span>Terminal area — PTY renderer mounts here</span>
            </div>
          </Show>
        </div>
      </div>

      <StatusBar />
    </div>
  );
};
