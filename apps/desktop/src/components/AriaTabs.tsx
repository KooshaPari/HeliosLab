// apps/desktop/src/components/AriaTabs.tsx
// ARIA tabs pattern with arrow-key navigation. Implements the WAI-ARIA
// tabs design pattern: role="tablist" / role="tab" / role="tabpanel",
// aria-selected, aria-controls, and roving tabindex.
//
// Reference: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

import { For, type Component, createSignal, Show } from "solid-js";

export interface TabDef {
  id: string;
  label: string;
  panel: () => unknown;
  ariaKeyshortcuts?: string;
}

interface AriaTabsProps {
  tabs: TabDef[];
  initialTab?: string;
  ariaLabel: string;
}

export const AriaTabs: Component<AriaTabsProps> = props => {
  const [activeId, setActiveId] = createSignal<string>(props.initialTab ?? props.tabs[0]?.id ?? "");

  const tabIds = (): string[] => props.tabs.map(t => t.id);

  const focusTab = (id: string): void => {
    setActiveId(id);
    queueMicrotask(() => {
      document.getElementById(`tab-${id}`)?.focus();
    });
  };

  const onKey = (e: KeyboardEvent) => {
    const ids = tabIds();
    const idx = ids.indexOf(activeId());
    if (idx < 0) return;

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusTab(ids[(idx + 1) % ids.length]!);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusTab(ids[(idx - 1 + ids.length) % ids.length]!);
        break;
      case "Home":
        e.preventDefault();
        if (ids[0]) focusTab(ids[0]);
        break;
      case "End":
        e.preventDefault();
        if (ids[ids.length - 1]) focusTab(ids[ids.length - 1]!);
        break;
    }
  };

  return (
    <div class="aria-tabs">
      <div role="tablist" aria-label={props.ariaLabel} onKeyDown={onKey}>
        <For each={props.tabs}>
          {t => (
            <button
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              aria-selected={activeId() === t.id}
              tabindex={activeId() === t.id ? 0 : -1}
              aria-keyshortcuts={t.ariaKeyshortcuts}
              onClick={() => focusTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <For each={props.tabs}>
        {t => (
          <Show when={activeId() === t.id}>
            <div role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} tabindex={0}>
              {t.panel()}
            </div>
          </Show>
        )}
      </For>
    </div>
  );
};
