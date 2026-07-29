import { type Component, createSignal, For, Show } from "solid-js";

type ModelGroup = {
  provider: string;
  models: Array<{ id: string; name: string; available: boolean }>;
};

type ModelSelectorProps = {
  activeModel: string;
  onSelect: (modelId: string) => void;
};

export const ModelSelector: Component<ModelSelectorProps> = props => {
  const [isOpen, setIsOpen] = createSignal(false);

  const modelGroups: ModelGroup[] = [
    {
      provider: "Cloud",
      models: [
        {
          id: "claude-sonnet-4-20250514",
          name: "Claude Sonnet 4",
          available: true,
        },
        {
          id: "claude-opus-4-20250514",
          name: "Claude Opus 4",
          available: true,
        },
        {
          id: "claude-haiku-4-20250514",
          name: "Claude Haiku 4",
          available: true,
        },
      ],
    },
    {
      provider: "Local (MLX)",
      models: [
        {
          id: "mlx-community/Llama-3.2-3B-Instruct",
          name: "Llama 3.2 3B",
          available: false,
        },
      ],
    },
    {
      provider: "Server (vLLM)",
      models: [{ id: "vllm/default", name: "vLLM Default", available: false }],
    },
  ];

  const activeModelName = () => {
    for (const group of modelGroups) {
      const found = group.models.find(m => m.id === props.activeModel);
      if (found) return found.name;
    }
    return props.activeModel.split("/").pop() ?? props.activeModel;
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen(!isOpen())}
        style={{
          background: "none",
          border: "1px solid #45475a",
          color: "#a6adc8",
          "border-radius": "6px",
          padding: "4px 8px",
          cursor: "pointer",
          "font-size": "12px",
          "white-space": "nowrap",
        }}
      >
        {activeModelName()} ▾
      </button>
      <Show when={isOpen()}>
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "0",
            "margin-bottom": "4px",
            "background-color": "#313244",
            "border-radius": "8px",
            border: "1px solid #45475a",
            padding: "8px 0",
            "min-width": "220px",
            "z-index": "100",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <For each={modelGroups}>
            {group => (
              <div>
                <div
                  style={{
                    padding: "4px 12px",
                    "font-size": "11px",
                    color: "#6c7086",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.5px",
                  }}
                >
                  {group.provider}
                </div>
                <For each={group.models}>
                  {model => (
                    <button
                      type="button"
                      onClick={() => {
                        if (model.available) {
                          props.onSelect(model.id);
                          setIsOpen(false);
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          if (model.available) {
                            props.onSelect(model.id);
                            setIsOpen(false);
                          }
                        }
                      }}
                      style={{
                        padding: "6px 12px",
                        cursor: model.available ? "pointer" : "default",
                        color: model.available ? "#cdd6f4" : "#585b70",
                        "font-size": "13px",
                        "background-color":
                          model.id === props.activeModel ? "#45475a" : "transparent",
                      }}
                    >
                      {model.name}
                      <Show when={!model.available}>
                        <span
                          style={{
                            "font-size": "11px",
                            "margin-left": "8px",
                            color: "#585b70",
                          }}
                        >
                          (not configured)
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
