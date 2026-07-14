

// In-memory persistence for renderer side
// Will be wired to main process via RPC when ElectroBun is integrated
const STORAGE_KEY = "helios_conversations";

// In-memory cache
let conversationsCache: Conversation[] = [];

/**
 * Load persisted conversations from localStorage
 * @returns Array of conversations
 */
export function loadPersistedConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Conversation[];
      conversationsCache = data;
      return data;
    }
  } catch {
    /* ignore parsing errors */
  }
  return [];
}

/**
 * Persist all conversations to localStorage
 * @param convs Array of conversations to persist
 */
export function persistConversations(convs: Conversation[]): void {
  conversationsCache = convs;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
  } catch {
    /* quota exceeded or unavailable */
  }
}

/**
 * Persist a single conversation, updating existing or adding new
 * @param conv Conversation to persist
 */
export function persistConversation(conv: Conversation): void {
  const current = conversationsCache;
  const idx = current.findIndex((c: Conversation) => c.id === conv.id);
  const updated =
    idx >= 0 ? current.map((c: Conversation) => (c.id === conv.id ? conv : c)) : [conv, ...current];
  persistConversations(updated);
}

/**
 * Delete a persisted conversation by ID
 * @param id Conversation ID to delete
 */
export function deletePersistedConversation(id: string): void {
  persistConversations(conversationsCache.filter((c: Conversation) => c.id !== id));
}

/**
 * Get all persisted conversations from cache
 * @returns Array of conversations
 */
export function getPersistedConversations(): Conversation[] {
  return conversationsCache;
}
