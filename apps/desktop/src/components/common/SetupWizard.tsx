import { type Component, createSignal, Show } from "solid-js";

type SetupWizardProps = {
  isOpen: boolean;
  onComplete: (apiKey: string) => void;
  onSkip: () => void;
};

export const SetupWizard: Component<SetupWizardProps> = props => {
  const [step, setStep] = createSignal(0);
  const [apiKey, setApiKey] = createSignal("");

  return (
    <Show when={props.isOpen}>
      <div
        style={{
          position: "fixed",
          inset: "0",
          "background-color": "rgba(0,0,0,0.7)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "2000",
        }}
      >
        <div
          style={{
            "background-color": "#1e1e2e",
            "border-radius": "16px",
            padding: "32px",
            "max-width": "480px",
            width: "100%",
            border: "1px solid #313244",
          }}
        >
          <Show when={step() === 0}>
            <h2 style={{ color: "#cdd6f4", "margin-bottom": "12px" }}>Welcome to Helios</h2>
            <p
              style={{
                color: "#a6adc8",
                "line-height": "1.6",
                "margin-bottom": "24px",
              }}
            >
              An agent-first desktop IDE. Chat with AI to write code, run commands, and build
              projects.
            </p>
            <button
              onClick={() => setStep(1)}
              style={{
                background: "#89b4fa",
                border: "none",
                color: "#1e1e2e",
                "border-radius": "8px",
                padding: "10px 24px",
                cursor: "pointer",
                "font-size": "14px",
                "font-weight": "bold",
              }}
            >
              Get Started
            </button>
          </Show>
          <Show when={step() === 1}>
            <h2 style={{ color: "#cdd6f4", "margin-bottom": "12px" }}>API Key</h2>
            <p
              style={{
                color: "#a6adc8",
                "margin-bottom": "16px",
                "font-size": "14px",
              }}
            >
              Enter your Anthropic API key to enable cloud inference.
            </p>
            <input
              type="password"
              value={apiKey()}
              onInput={e => setApiKey(e.currentTarget.value)}
              placeholder="sk-ant-..."
              style={{
                width: "100%",
                padding: "10px 12px",
                "background-color": "#313244",
                border: "1px solid #45475a",
                "border-radius": "8px",
                color: "#cdd6f4",
                "font-size": "14px",
                "box-sizing": "border-box",
                "margin-bottom": "16px",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "8px",
                "justify-content": "flex-end",
              }}
            >
              <button
                onClick={() => props.onSkip()}
                style={{
                  background: "none",
                  border: "1px solid #45475a",
                  color: "#a6adc8",
                  "border-radius": "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
              >
                Skip
              </button>
              <button
                onClick={() => props.onComplete(apiKey())}
                style={{
                  background: "#89b4fa",
                  border: "none",
                  color: "#1e1e2e",
                  "border-radius": "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                  "font-weight": "bold",
                }}
              >
                Save
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
