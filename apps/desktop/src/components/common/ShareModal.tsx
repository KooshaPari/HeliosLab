import { type Component, createSignal } from "solid-js";
import { Show } from "solid-js";

type ShareModalProps = {
  isOpen: boolean;
  shareUrl: string;
  onClose: () => void;
};

export const ShareModal: Component<ShareModalProps> = props => {
  const [copied, setCopied] = createSignal(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(props.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API unavailable */
    }
  };

  return (
    <Show when={props.isOpen}>
      <div
        style={{
          position: "fixed",
          inset: "0",
          "background-color": "rgba(0,0,0,0.5)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "1000",
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            "background-color": "#313244",
            "border-radius": "12px",
            padding: "24px",
            "min-width": "400px",
            "max-width": "500px",
          }}
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          <h3
            style={{
              color: "#cdd6f4",
              margin: "0 0 16px 0",
              "font-size": "16px",
            }}
          >
            Share Terminal Session
          </h3>
          <div
            style={{
              display: "flex",
              gap: "8px",
              "background-color": "#181825",
              "border-radius": "8px",
              padding: "8px 12px",
              "align-items": "center",
            }}
          >
            <code
              style={{
                flex: "1",
                color: "#89b4fa",
                "font-size": "13px",
                "word-break": "break-all",
              }}
            >
              {props.shareUrl || "Generating link..."}
            </code>
            <button
              onClick={copyToClipboard}
              style={{
                background: copied() ? "#a6e3a1" : "#89b4fa",
                border: "none",
                color: "#1e1e2e",
                "border-radius": "6px",
                padding: "6px 12px",
                cursor: "pointer",
                "font-size": "12px",
                "white-space": "nowrap",
              }}
            >
              {copied() ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={props.onClose}
            style={{
              "margin-top": "16px",
              background: "none",
              border: "1px solid #45475a",
              color: "#a6adc8",
              "border-radius": "6px",
              padding: "6px 16px",
              cursor: "pointer",
              "font-size": "13px",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </Show>
  );
};
