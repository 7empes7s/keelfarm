// The chat's Files & artifacts (#132): every artifact the CEO wrote and every file sent in a thread, a project (a
// floor's threads) or the whole office, as one list of cards, newest first, with the All / Artifacts / Images /
// Documents filter and pages. Pure: the phone builds the open thread's list itself, the office the rest (GET /api/ceo/library).
import { fileKind, type FileRef } from './files.ts';
import type { ChatArtifact, PhoneMessage } from './types.ts';

type LibraryKind = 'artifact' | 'image' | 'document';
export type LibraryFilter = 'all' | LibraryKind;
export const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'artifact', label: 'Artifacts' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
];
const LIBRARY_PAGE = 24;

/** One card: an artifact (opens the reader) or a file (opens the viewer), and where it was sent. */
export interface LibraryItem {
  key: string; // `<conversation id>:<artifact id>` (message ids can repeat across threads), or `f:<file id>`
  kind: LibraryKind;
  title: string;
  at: number;
  size: number | null; // bytes; null for an artifact whose text the phone doesn't have
  lead?: string; // an artifact's first line
  from: PhoneMessage['from'] | FileRef['from'];
  messageId: number | null; // null: a stored file no message carries
  conversationId: string | null;
  file?: FileRef;
  artifact?: ChatArtifact; // with its markdown when the office sent the list (another thread's)
}

/** A thread: its id and messages. */
export interface LibraryThread {
  id: string;
  messages: readonly Pick<PhoneMessage, 'id' | 'from' | 'at' | 'artifacts' | 'attachments'>[];
}

const kindOf = (f: Pick<FileRef, 'name' | 'type'>): LibraryKind => {
  const k = fileKind(f.name, f.type);
  return k === 'image' || k === 'video' ? 'image' : 'document';
};

/**
 * Every artifact and attachment of `threads`, newest first, each once (a file sent twice: its latest message), then
 * the stored files no message carries (`stored`, for the whole office). `markdown`: keep the artifacts' text.
 */
export function libraryItems(threads: readonly LibraryThread[], stored: readonly FileRef[] = [], markdown = false): LibraryItem[] {
  const out = new Map<string, LibraryItem>();
  for (const t of threads)
    for (const m of t.messages) {
      for (const a of m.artifacts ?? []) {
        const artifact = markdown ? a : { id: a.id, title: a.title, lead: a.lead };
        out.set(`${t.id}:${a.id}`, { key: `${t.id}:${a.id}`, kind: 'artifact', title: a.title, lead: a.lead, at: m.at, size: a.markdown === undefined ? null : new TextEncoder().encode(a.markdown).length, from: m.from, messageId: m.id, conversationId: t.id, artifact });
      }
      for (const f of m.attachments ?? []) {
        const key = `f:${f.id}`;
        const was = out.get(key);
        if (!was || was.at <= m.at) out.set(key, { key, kind: kindOf(f), title: f.name, at: m.at, size: f.size, from: f.from, messageId: m.id, conversationId: t.id, file: f });
      }
    }
  for (const f of stored) if (!out.has(`f:${f.id}`)) out.set(`f:${f.id}`, { key: `f:${f.id}`, kind: kindOf(f), title: f.name, at: f.at, size: f.size, from: f.from, messageId: null, conversationId: null, file: f });
  return [...out.values()].sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : -1));
}

export const filterLibrary = (items: readonly LibraryItem[], filter: LibraryFilter) => (filter === 'all' ? [...items] : items.filter((i) => i.kind === filter));

/** How many of each, for the filter's labels (and the 📎 count: `all`). */
export function libraryCounts(items: readonly LibraryItem[]): Record<LibraryFilter, number> {
  const n: Record<LibraryFilter, number> = { all: items.length, artifact: 0, image: 0, document: 0 };
  for (const i of items) n[i.kind] += 1;
  return n;
}

/** A page after the card `after` (its key; absent: the first page), and the key to ask for the next one with (null: no more). */
export function pageLibrary(items: readonly LibraryItem[], after: string | undefined, limit = LIBRARY_PAGE): { items: LibraryItem[]; next: string | null } {
  const from = after ? items.findIndex((i) => i.key === after) + 1 : 0;
  const page = items.slice(from, from + Math.max(1, limit));
  return { items: page, next: from + page.length < items.length ? (page.at(-1)?.key ?? null) : null };
}

/** GET /api/ceo/library's answer. */
export interface LibraryPage {
  items: LibraryItem[];
  next: string | null;
  counts: Record<LibraryFilter, number>;
}

/** GET /api/ceo/library's query: `scope` (all, company or a floor's repo id; default all), `filter`, `after`. */
export function libraryQuery(q: Record<string, unknown>): { scope: string; filter: LibraryFilter; after?: string } {
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  const filter = LIBRARY_FILTERS.find((f) => f.id === q.filter)?.id ?? 'all';
  return { scope: str(q.scope) || 'all', filter, ...(str(q.after) && { after: str(q.after) }) };
}
