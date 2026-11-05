// The CEO chat's conversations (#51): start a new one (a fresh CEO session) or carry on an old one, the list with
// titles, pins and search. Each keeps its own thread and CEO session; the CEO's notes are shared by all. Pure.
import type { PhoneMessage } from './types.ts';

export interface Conversation {
  id: string;
  title: string; // from its first message from the manager
  startedAt: number;
  updatedAt: number;
  pinned: boolean;
  count: number; // messages in it
}

/** The server's: each conversation with the CEO session it resumes (null: the next job starts a fresh one). */
export interface ChatsState {
  current: string;
  list: (Conversation & { sessionId: string | null })[];
}

/** A search hit: the conversation, and the words around the match. */
export interface ConversationHit {
  id: string;
  snippet: string;
}

export const MAX_CONVERSATIONS = 100;
export const UNTITLED = 'New conversation';
const TITLE_MAX = 60;

const newId = (now: number) => `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A title from the manager's first message: its first line, short. */
export function titleFrom(text: string): string {
  const line = text.replace(/^Research:\s*/i, '🔎 ').split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line || UNTITLED;
}

/** The saved list, cleaned; an office from before conversations gets one, holding the thread it has. */
export function loadChats(raw: unknown, messages: readonly PhoneMessage[], now: number): ChatsState {
  const r = raw as Partial<ChatsState> | undefined;
  const list = (Array.isArray(r?.list) ? r.list : []).filter((c) => c && typeof c.id === 'string').map((c) => ({
    id: c.id,
    title: typeof c.title === 'string' && c.title ? c.title : UNTITLED,
    startedAt: Number(c.startedAt) || now,
    updatedAt: Number(c.updatedAt) || now,
    pinned: c.pinned === true,
    count: Number(c.count) || 0,
    sessionId: typeof c.sessionId === 'string' ? c.sessionId : null,
  }));
  if (r && typeof r.current === 'string' && list.some((c) => c.id === r.current)) return { current: r.current, list };
  const first = messages.find((m) => m.from === 'manager');
  const c = { id: newId(now), title: first ? titleFrom(first.text) : UNTITLED, startedAt: messages[0]?.at ?? now, updatedAt: messages.at(-1)?.at ?? now, pinned: false, count: messages.length, sessionId: null };
  return { current: c.id, list: [...list, c] };
}

export const currentConversation = (s: ChatsState) => s.list.find((c) => c.id === s.current)!;

/**
 * Starts a new, empty conversation and makes it the current one. `sessionId`: the CEO session the one left behind
 * resumes when it is opened again. Returns the ids of old unpinned conversations dropped over MAX_CONVERSATIONS.
 */
export function startConversation(s: ChatsState, sessionId: string | null, now: number): string[] {
  currentConversation(s).sessionId = sessionId;
  const c = { id: newId(now), title: UNTITLED, startedAt: now, updatedAt: now, pinned: false, count: 0, sessionId: null };
  s.list.push(c);
  s.current = c.id;
  return prune(s);
}

/** Makes `id` the current conversation; returns the CEO session to resume in it. Throws for one that's gone. */
export function openConversation(s: ChatsState, id: string, sessionId: string | null): string | null {
  const to = s.list.find((c) => c.id === id);
  if (!to) throw new Error('That conversation is no longer saved.');
  currentConversation(s).sessionId = sessionId;
  s.current = id;
  return to.sessionId;
}

function prune(s: ChatsState): string[] {
  const extra = s.list.length - MAX_CONVERSATIONS;
  if (extra <= 0) return [];
  const drop = s.list.filter((c) => !c.pinned && c.id !== s.current).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, extra).map((c) => c.id);
  s.list = s.list.filter((c) => !drop.includes(c.id));
  return drop;
}

/** A message joined the current conversation: its count and time, and its title from the manager's first message. */
export function touchConversation(s: ChatsState, m: Pick<PhoneMessage, 'from' | 'text' | 'at'>) {
  const c = currentConversation(s);
  c.count += 1;
  c.updatedAt = m.at;
  if (c.title === UNTITLED && m.from === 'manager' && m.text.trim()) c.title = titleFrom(m.text);
}

export function pinConversation(s: ChatsState, id: string, pinned: boolean) {
  const c = s.list.find((x) => x.id === id);
  if (!c) throw new Error('That conversation is no longer saved.');
  c.pinned = pinned;
}

/** The list the phone shows: pinned first, then the latest; no sessions. */
export const conversationsView = (s: ChatsState): Conversation[] =>
  [...s.list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt).map(({ id, title, startedAt, updatedAt, pinned, count }) => ({ id, title, startedAt, updatedAt, pinned, count }));

const SNIPPET = 40;

/** Conversations whose title or messages hold every word of `q` (any case), in the list's order, with a snippet of the match. */
export function searchConversations(list: readonly Conversation[], threads: ReadonlyMap<string, readonly Pick<PhoneMessage, 'text' | 'from'>[]>, q: string): ConversationHit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: ConversationHit[] = [];
  for (const c of list) {
    const texts = [c.title, ...(threads.get(c.id) ?? []).filter((m) => m.from !== 'office').map((m) => m.text)];
    const all = texts.join('\n').toLowerCase();
    if (!words.every((w) => all.includes(w))) continue;
    const text = texts.find((t) => t.toLowerCase().includes(words[0]))!;
    const at = text.toLowerCase().indexOf(words[0]);
    const from = Math.max(0, at - SNIPPET);
    const snippet = `${from > 0 ? '…' : ''}${text.slice(from, at + words[0].length + SNIPPET).replace(/\s+/g, ' ').trim()}${at + words[0].length + SNIPPET < text.length ? '…' : ''}`;
    hits.push({ id: c.id, snippet });
  }
  return hits;
}
