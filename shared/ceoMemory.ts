// "What the CEO remembers" (#51): the manager's own pinned notes, given to the CEO in every job. Small and capped,
// since every job pays for them. The CEO's own notes file (NOTES.md) is shown beside them, read-only. Pure.

export interface MemoryNote {
  id: string;
  text: string;
  at: number; // added or last edited
}

export const MEMORY_MAX_NOTES = 12;
export const MEMORY_NOTE_MAX = 300; // characters
export const MEMORY_TOTAL_MAX = 2000;
/** The most of NOTES.md the memory screen shows. */
export const NOTES_VIEW_MAX = 64_000;

/** The saved notes, cleaned. */
export function loadMemory(raw: unknown): MemoryNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is MemoryNote => !!n && typeof n.id === 'string' && typeof n.text === 'string' && n.text.trim() !== '')
    .slice(0, MEMORY_MAX_NOTES)
    .map((n) => ({ id: n.id, text: n.text.trim().slice(0, MEMORY_NOTE_MAX), at: Number(n.at) || 0 }));
}

const total = (notes: readonly MemoryNote[]) => notes.reduce((n, x) => n + x.text.length, 0);

/** Why `text` can't be saved as note `id` (null: a new one), or null when it can. */
function refusal(notes: readonly MemoryNote[], text: string, id: string | null): string | null {
  if (!text) return 'Write the note first.';
  if (text.length > MEMORY_NOTE_MAX) return `Keep a note under ${MEMORY_NOTE_MAX} characters (this one has ${text.length}).`;
  if (id === null && notes.length >= MEMORY_MAX_NOTES) return `The CEO keeps ${MEMORY_MAX_NOTES} notes at most: delete one first.`;
  const others = notes.filter((n) => n.id !== id);
  if (total(others) + text.length > MEMORY_TOTAL_MAX) return `Notes are capped at ${MEMORY_TOTAL_MAX} characters in all, since every CEO job reads them: shorten or delete one.`;
  return null;
}

/** The notes with a new one (or `id` edited); throws with what to do when it doesn't fit. */
export function saveNote(notes: readonly MemoryNote[], raw: string, now: number, id: string | null = null): MemoryNote[] {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (id !== null && !notes.some((n) => n.id === id)) throw new Error('That note is gone.');
  const why = refusal(notes, text, id);
  if (why) throw new Error(why);
  if (id !== null) return notes.map((n) => (n.id === id ? { ...n, text, at: now } : n));
  return [...notes, { id: `m${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, at: now }];
}

export function removeNote(notes: readonly MemoryNote[], id: string): MemoryNote[] {
  if (!notes.some((n) => n.id === id)) throw new Error('That note is gone.');
  return notes.filter((n) => n.id !== id);
}

/** The block a CEO job's prompt ends with ('' without notes). */
export function memoryPrompt(notes: readonly MemoryNote[]): string {
  if (!notes.length) return '';
  return `\n\nThe manager asked you to always remember:\n${notes.map((n) => `- ${n.text}`).join('\n')}`;
}

