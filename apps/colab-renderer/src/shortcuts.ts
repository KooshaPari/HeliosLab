import { onCleanup, onMount } from "solid-js";
import { newChat, toggleSidebar, toggleTerminal } from "./stores/app.store";

function isMeta(e: KeyboardEvent): boolean {
	return e.metaKey || e.ctrlKey;
}

function handleGlobalShortcut(e: KeyboardEvent): void {
	if (isMeta(e) && e.key === "n") {
		e.preventDefault();
		newChat();
		return;
	}

	if (isMeta(e) && e.key === "`") {
		e.preventDefault();
		toggleTerminal();
		return;
	}

	if (isMeta(e) && e.key === "b") {
		e.preventDefault();
		toggleSidebar();
		return;
	}
}

export function useKeyboardShortcuts(): void {
	onMount(() => {
		window.addEventListener("keydown", handleGlobalShortcut);
	});

	onCleanup(() => {
		window.removeEventListener("keydown", handleGlobalShortcut);
	});
}
