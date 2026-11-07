// The CEO chat in pages (#145), WhatsApp-style: the snapshot carries the latest page, older ones load as the manager
// scrolls up, the scroll held where it was. And removing a message: the manager's and the office's are deleted, the
// CEO's hidden from the manager. Pure, for the server, the store and the tests.
import type { PhoneMessage } from './types.ts';

/** Messages per page: what the chat opens on, and what each scroll to the top adds. */
export const CHAT_PAGE = 40;
/** The most one request may ask for. */
export const CHAT_PAGE_MAX = 100;
/** The most a thread keeps, on the server and in a tab. */
export const CHAT_KEEP = 500;
/** How close to the top (px) the list starts loading the page before. */
export const LOAD_OLDER_PX = 200;
/** How long a removal can be undone before it goes to the office. */
export const UNDO_MS = 5000;

export interface ChatPage {
  messages: PhoneMessage[];
  older: boolean; // there are earlier messages than these
}

/** The messages a phone may see: hidden ones (the CEO's the manager hid) never leave the server. */
const visibleMessages = (messages: readonly PhoneMessage[]) => messages.filter((m) => !m.hidden);

/** The `limit` visible messages before `before` (an id; none: the latest), oldest first. */
export function pageBefore(messages: readonly PhoneMessage[], before = Infinity, limit = CHAT_PAGE): ChatPage {
  const n = Math.max(1, Math.min(CHAT_PAGE_MAX, Math.floor(limit) || CHAT_PAGE));
  const earlier = visibleMessages(messages).filter((m) => m.id < before);
  return { messages: earlier.slice(-n), older: earlier.length > n };
}

/** An older page joined onto what a tab has: by id, oldest first, never twice. */
export function withOlder(have: readonly PhoneMessage[], older: readonly PhoneMessage[]): PhoneMessage[] {
  const ids = new Set(have.map((m) => m.id));
  return [...older.filter((m) => !ids.has(m.id)), ...have].sort((a, b) => a.id - b.id);
}

/** A new message at the end of a tab's thread, kept to CHAT_KEEP: `older` turns on when the oldest drop off. */
export function withNewest(have: readonly PhoneMessage[], m: PhoneMessage, older: boolean): ChatPage {
  const all = [...have, m];
  return all.length > CHAT_KEEP ? { messages: all.slice(-CHAT_KEEP), older: true } : { messages: all, older };
}

/** Where the list scrolls to after a page went in above: the same message stays under the finger (no jump). */
export const anchoredTop = (before: { top: number; height: number }, height: number) => Math.max(0, before.top + height - before.height);

/** Whether the list is close enough to its top to load the page before. */
export const wantsOlder = (top: number, s: { older: boolean; loading: boolean }) => s.older && !s.loading && top < LOAD_OLDER_PX;

/**
 * The CEO's first unread message, where the "New messages" divider goes when the chat opens: none while the unread
 * may begin on a page not loaded yet (no read CEO message before it and `older`), so the chat opens at the end
 * instead of at its top, which would pull in the page before.
 */
export function firstUnread(messages: readonly PhoneMessage[], readAt: number, older: boolean): number | null {
  const fromCeo = (m: PhoneMessage) => m.from === 'ceo' && !m.requestId;
  const i = messages.findIndex((m) => fromCeo(m) && m.at > readAt);
  if (i < 0 || (older && !messages.slice(0, i).some(fromCeo))) return null;
  return messages[i].id;
}

/** What removing a message does: the manager's own and the office's notices are deleted, the CEO's only hidden. */
export function removal(m: Pick<PhoneMessage, 'from'>): 'delete' | 'hide' {
  return m.from === 'ceo' ? 'hide' : 'delete';
}

/** The thread with a message removed: gone from the list, or (the CEO's) kept and marked hidden. */
export function removeMessage(messages: readonly PhoneMessage[], id: number): PhoneMessage[] | null {
  const m = messages.find((x) => x.id === id);
  if (!m || m.hidden) return null;
  return removal(m) === 'hide' ? messages.map((x) => (x.id === id ? { ...x, hidden: true as const } : x)) : messages.filter((x) => x.id !== id);
}
