import { loadPersistedConversations } from "./stores/persistence.store";

export function initializeApp(): void {
	// Load persisted conversations on startup
	const convs = loadPersistedConversations();
	console.log(`[helios] Loaded ${convs.length} persisted conversations`);
}
