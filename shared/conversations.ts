// The CEO chat's conversations (#51), shown as threads (#132): start a new one (a fresh CEO session, in a floor's
// project or the Company) or carry on an old one, the list with titles, pins, archive, the floors each named, its
// unread dot, Today / This week / Older groups and search. Each keeps its own thread and CEO session; the CEO's notes
// are shared by all. Pure.
import type { PhoneMessage } from './types.ts';

export interface Conversation {
  id: string;
  title: string; // from its first message from the manager
  startedAt: number;
  updatedAt: number;
  pinned: boolean;
  count: number; // messages in it
  // Absent in journals from before threads (#132):
  repoId?: string | null; // its project: a floor's repo id; null: a Company thread
  floors?: string[]; // the floors its messages named (repo ids), first named first
  archived?: boolean; // out of the list until "Archived" is shown
  ceoAt?: number; // the CEO's latest message in it, for the unread dot (0: none)
  files?: number; // its artifacts and attachments
}

type Saved = Conversation & Required<Pick<Conversation, 'repoId' | 'floors' | 'archived' | 'ceoAt' | 'files'>> & { sessionId: string | null };

/** What a thread's messages say about it: the floors they named, its files and the CEO's latest message. */
type Touch = Pick<PhoneMessage, 'from' | 'text' | 'at'> & Partial<Pick<PhoneMessage, 'refs' | 'artifacts' | 'attachments' | 'research'>>;

/** The server's: each conversation with the CEO session it resumes (null: the next job starts a fresh one). */
export interface ChatsState {
  current: string;
  list: Saved[];
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
const fresh = (now: number, repoId: string | null = null): Saved => ({ id: newId(now), title: UNTITLED, startedAt: now, updatedAt: now, pinned: false, count: 0, sessionId: null, repoId, floors: [], archived: false, ceoAt: 0, files: 0 });

const floorsOf = (m: Touch) => [...(m.refs ?? []).flatMap((r) => ('repoId' in r ? [r.repoId] : [])), ...(m.research?.repoId ? [m.research.repoId] : [])];

/** Folds one message into a thread's floors, files and CEO time; true when one of them changed. */
function fold(c: Pick<Saved, 'floors' | 'files' | 'ceoAt'>, m: Touch): boolean {
  const floors = [...new Set([...c.floors, ...floorsOf(m)])];
  const files = c.files + (m.artifacts?.length ?? 0) + (m.attachments?.length ?? 0);
  const ceoAt = m.from === 'ceo' ? Math.max(c.ceoAt, m.at) : c.ceoAt;
  const changed = floors.length !== c.floors.length || files !== c.files || ceoAt !== c.ceoAt;
  Object.assign(c, { floors, files, ceoAt });
  return changed;
}

/** A thread's floors, files and CEO time from its messages (for threads saved before #132). */
export function threadStats(messages: readonly Touch[]): Pick<Saved, 'floors' | 'files' | 'ceoAt'> {
  const c = { floors: [] as string[], files: 0, ceoAt: 0 };
  for (const m of messages) fold(c, m);
  return c;
}

/** The saved ones from before #132, to fill from their threads with threadStats. */
export const unfilled = (raw: unknown): string[] => ((raw as Partial<ChatsState> | undefined)?.list ?? []).filter((c) => c && typeof c.id === 'string' && !Array.isArray(c.floors)).map((c) => c.id);

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
    repoId: typeof c.repoId === 'string' ? c.repoId : null,
    floors: Array.isArray(c.floors) ? c.floors.filter((f) => typeof f === 'string') : [],
    archived: c.archived === true,
    ceoAt: Number(c.ceoAt) || 0,
    files: Number(c.files) || 0,
  }));
  if (r && typeof r.current === 'string' && list.some((c) => c.id === r.current)) {
    const cur = list.find((c) => c.id === r.current)!;
    if (!Array.isArray(r.list?.find((c) => c.id === r.current)?.floors)) Object.assign(cur, threadStats(messages)); // its thread is the one in state.messages
    return { current: r.current, list };
  }
  const first = messages.find((m) => m.from === 'manager');
  const c: Saved = { ...fresh(now), title: first ? titleFrom(first.text) : UNTITLED, startedAt: messages[0]?.at ?? now, updatedAt: messages.at(-1)?.at ?? now, count: messages.length, ...threadStats(messages) };
  return { current: c.id, list: [...list, c] };
}

/** The conversation the phone shows; an office's first one starts here. */
export function currentConversation(s: ChatsState) {
  const c = s.list.find((x) => x.id === s.current);
  if (c) return c;
  const first = fresh(Date.now());
  s.list.push(first);
  s.current = first.id;
  return first;
}

/**
 * Starts a new, empty conversation and makes it the current one. `sessionId`: the CEO session the one left behind
 * resumes when it is opened again; `repoId`: its project (null: the Company). Returns the ids of old unpinned
 * conversations dropped over MAX_CONVERSATIONS.
 */
export function startConversation(s: ChatsState, sessionId: string | null, now: number, repoId: string | null = null): string[] {
  currentConversation(s).sessionId = sessionId;
  const c = fresh(now, repoId);
  s.list.push(c);
  s.current = c.id;
  return prune(s);
}

/** Makes `id` the current conversation (one left empty goes); returns the CEO session to resume in it. Throws for one that's gone. */
export function openConversation(s: ChatsState, id: string, sessionId: string | null): string | null {
  const to = s.list.find((c) => c.id === id);
  if (!to) throw new Error('That conversation is no longer saved.');
  const left = currentConversation(s);
  left.sessionId = sessionId;
  if (left.count === 0 && !left.pinned) s.list = s.list.filter((c) => c !== left);
  s.current = id;
  return to.sessionId;
}

function prune(s: ChatsState): string[] {
  const extra = s.list.length - MAX_CONVERSATIONS;
  if (extra <= 0) return [];
  const drop = s.list.filter((c) => !c.pinned && c.id !== s.current).sort((a, b) => Number(b.archived) - Number(a.archived) || a.updatedAt - b.updatedAt).slice(0, extra).map((c) => c.id);
  s.list = s.list.filter((c) => !drop.includes(c.id));
  return drop;
}

/**
 * A message joined the current conversation: its count and time, its title from the manager's first message, the
 * floors it names, its files and the CEO's time. True when the list shows something new (title, floors, files, unread).
 */
export function touchConversation(s: ChatsState, m: Touch): boolean {
  const c = currentConversation(s);
  c.count += 1;
  c.updatedAt = m.at;
  const folded = fold(c, m);
  if (c.title !== UNTITLED || m.from !== 'manager' || !m.text.trim()) return folded;
  c.title = titleFrom(m.text);
  return true;
}

export function pinConversation(s: ChatsState, id: string, pinned: boolean) {
  editConversation(s, id, { pinned });
}

/** What the manager may change on a thread (#132): its title, pin, archive and project. */
export interface ConversationPatch {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  repoId?: string | null;
}

/** A request body as a patch; throws what to fix. `repoIds`: the floors a thread's project may be. */
export function conversationPatch(raw: unknown, repoIds: readonly string[]): ConversationPatch {
  const b = (raw ?? {}) as Record<string, unknown>;
  const p: ConversationPatch = {};
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim()) throw new Error('Give the thread a title.');
    p.title = titleFrom(b.title);
  }
  for (const k of ['pinned', 'archived'] as const) if (b[k] !== undefined) p[k] = b[k] === true;
  if (b.repoId !== undefined) {
    if (b.repoId !== null && (typeof b.repoId !== 'string' || !repoIds.includes(b.repoId))) throw new Error('That floor is no longer in the office.');
    p.repoId = b.repoId;
  }
  return p;
}

export function editConversation(s: ChatsState, id: string, p: ConversationPatch) {
  const c = s.list.find((x) => x.id === id);
  if (!c) throw new Error('That conversation is no longer saved.');
  Object.assign(c, p);
}

/** The list the phone shows: pinned first, then the latest; no sessions. */
export const conversationsView = (s: ChatsState): Conversation[] =>
  [...s.list]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    // in every snapshot: the defaults (a Company thread, no floors or files, not archived) are left out
    .map(({ id, title, startedAt, updatedAt, pinned, count, repoId, floors, archived, ceoAt, files }) => ({ id, title, startedAt, updatedAt, pinned, count, ...(repoId && { repoId }), ...(floors.length && { floors }), ...(archived && { archived }), ...(ceoAt && { ceoAt }), ...(files && { files }) }));

/** The thread has a CEO message the manager hasn't read (`readAt`: the phone's read time). */
export const unreadThread = (c: Pick<Conversation, 'ceoAt'>, readAt: number) => (c.ceoAt ?? 0) > readAt;

export type ThreadGroup = 'Pinned' | 'Today' | 'This week' | 'Older';
const DAY = 24 * 3600_000;

/** Which list filter: 'all' threads, the 'company' ones, or a floor's repo id: its project (its own and the Company's that named it). */
export type ThreadScope = string;

export const inScope = (c: Pick<Conversation, 'repoId' | 'floors'>, scope: ThreadScope) =>
  scope === 'all' || (scope === 'company' ? !c.repoId : c.repoId === scope || (!c.repoId && !!c.floors?.includes(scope)));

/**
 * The threads list like Claude's sidebar: pinned, then by last activity in Today / This week / Older (local days,
 * from `now`), only the scope's, archived ones only when `archived`, and only `ids` when a search gave some.
 */
export function groupThreads(list: readonly Conversation[], now: number, o: { scope?: ThreadScope; archived?: boolean; ids?: readonly string[] | null } = {}): { group: ThreadGroup; threads: Conversation[] }[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const keep = list.filter((c) => !!c.archived === !!o.archived && inScope(c, o.scope ?? 'all') && (!o.ids || o.ids.includes(c.id)));
  const groupOf = (c: Conversation): ThreadGroup => (c.pinned ? 'Pinned' : c.updatedAt >= midnight ? 'Today' : c.updatedAt >= midnight - 6 * DAY ? 'This week' : 'Older');
  const order: ThreadGroup[] = ['Pinned', 'Today', 'This week', 'Older'];
  return order
    .map((group) => ({ group, threads: keep.filter((c) => groupOf(c) === group).sort((a, b) => b.updatedAt - a.updatedAt) }))
    .filter((g) => g.threads.length);
}

/** A project thread's first message to the CEO says which floor it is about (one short line, paid once per thread). */
export function projectLine(s: ChatsState, messages: readonly Pick<PhoneMessage, 'id' | 'from'>[], m: Pick<PhoneMessage, 'id'>, repos: readonly { id: string; floor: number; fullName: string }[]): string {
  const repoId = currentConversation(s).repoId;
  const r = repos.find((x) => x.id === repoId);
  if (!r || messages.find((x) => x.from === 'manager')?.id !== m.id) return '';
  return `(This thread is in the project of floor ${r.floor}, ${r.fullName}.)`;
}

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
