import { createSignal } from "solid-js";

export type AppState = {
	activeConversationId: string | null;
	isStreaming: boolean;
	sidebarVisible: boolean;
	terminalVisible: boolean;
	activeModel: string;
	connectionStatus: "connected" | "disconnected" | "reconnecting";
};

const initialState: AppState = {
	activeConversationId: null,
	isStreaming: false,
	sidebarVisible: true,
	terminalVisible: true,
	activeModel: "claude-sonnet-4-20250514",
	connectionStatus: "disconnected",
};

const [appState, setAppState] = createSignal<AppState>(initialState);

export function getAppState(): AppState {
	return appState();
}

export function updateAppState(partial: Partial<AppState>): void {
	setAppState((prev: AppState) => ({ ...prev, ...partial }));
}

export function toggleSidebar(): void {
	setAppState((prev: AppState) => ({
		...prev,
		sidebarVisible: !prev.sidebarVisible,
	}));
}

export function toggleTerminal(): void {
	setAppState((prev: AppState) => ({
		...prev,
		terminalVisible: !prev.terminalVisible,
	}));
}

export function newChat(): void {
	const id = `conv-${Date.now()}`;
	setAppState((prev: AppState) => ({ ...prev, activeConversationId: id }));
}
