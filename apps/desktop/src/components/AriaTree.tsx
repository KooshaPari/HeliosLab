// apps/desktop/src/components/AriaTree.tsx
// ARIA tree pattern for the file tree. Implements the WAI-ARIA treeview
// design pattern with proper role="tree" / role="treeitem" / aria-expanded
// / aria-selected / aria-level, and roving tabindex arrow-key navigation.
//
// Reference: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/

import { For, type Component, createSignal } from "solid-js";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

interface AriaTreeProps {
  nodes: TreeNode[];
  "aria-label": string;
  onActivate?: (id: string) => void;
}

export const AriaTree: Component<AriaTreeProps> = props => {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  const isOpen = (id: string): boolean => expanded()[id] ?? false;

  const toggleOpen = (id: string): void => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const flattenVisible = (nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      out.push(node);
      if (node.children && isOpen(node.id)) {
        out.push(...flattenVisible(node.children));
      }
    }
    return out;
  };

  const focusNode = (id: string): void => {
    setFocusedId(id);
    queueMicrotask(() => {
      document.querySelector(`[data-treeitem-id="${id}"]`)?.focus();
    });
  };

  const onKey = (e: KeyboardEvent) => {
    const ids = flattenVisible(props.nodes).map(n => n.id);
    const current = focusedId();
    if (!current) return;
    const idx = ids.indexOf(current);
    if (idx < 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < ids.length - 1) focusNode(ids[idx + 1]!);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx > 0) focusNode(ids[idx - 1]!);
        break;
      case "Home":
        e.preventDefault();
        if (ids[0]) focusNode(ids[0]);
        break;
      case "End":
        e.preventDefault();
        if (ids[ids.length - 1]) focusNode(ids[ids.length - 1]!);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        setSelectedId(current);
        props.onActivate?.(current);
        break;
    }
  };

  return (
    <ul role="tree" aria-label={props["aria-label"]} onKeyDown={onKey} class="aria-tree">
      <For each={props.nodes}>
        {node => (
          <AriaTreeItem
            node={node}
            level={1}
            isOpen={isOpen}
            toggleOpen={toggleOpen}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            focusedId={focusedId}
            focusNode={focusNode}
            onActivate={props.onActivate}
          />
        )}
      </For>
    </ul>
  );
};

interface AriaTreeItemProps {
  node: TreeNode;
  level: number;
  isOpen: (id: string) => boolean;
  toggleOpen: (id: string) => void;
  selectedId: () => string | null;
  setSelectedId: (id: string | null) => void;
  focusedId: () => string | null;
  focusNode: (id: string) => void;
  onActivate?: (id: string) => void;
}

const AriaTreeItem: Component<AriaTreeItemProps> = props => {
  const hasChildren = () => Array.isArray(props.node.children) && props.node.children.length > 0;

  return (
    <li
      role="treeitem"
      data-treeitem-id={props.node.id}
      aria-expanded={hasChildren() ? props.isOpen(props.node.id) : undefined}
      aria-selected={props.selectedId() === props.node.id}
      aria-level={props.level}
      tabindex={props.focusedId() === props.node.id ? 0 : -1}
      onClick={() => {
        if (hasChildren()) props.toggleOpen(props.node.id);
        props.setSelectedId(props.node.id);
        props.focusNode(props.node.id);
        props.onActivate?.(props.node.id);
      }}
    >
      {props.node.label}
      {hasChildren() && props.isOpen(props.node.id) && (
        <ul role="group">
          <For each={props.node.children}>
            {child => (
              <AriaTreeItem
                node={child}
                level={props.level + 1}
                isOpen={props.isOpen}
                toggleOpen={props.toggleOpen}
                selectedId={props.selectedId}
                setSelectedId={props.setSelectedId}
                focusedId={props.focusedId}
                focusNode={props.focusNode}
                onActivate={props.onActivate}
              />
            )}
          </For>
        </ul>
      )}
    </li>
  );
};
